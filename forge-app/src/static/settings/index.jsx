// The Fleet settings page — UI Kit (@forge/react), rendered natively inside
// Jira's project settings.
//
// This file is the thin rendering layer. Everything it decides is in model.js,
// and everything it can do is a resolver call whose rules live in
// src/settings/resolver.js. That split exists because @forge/react refuses to
// load outside a Forge host, so the model is what the tests can reach.
//
// It renders the page the grill doc describes: connection, worker timings, MCP
// tokens, the generated worker .env, the MCP client config, the read-only
// protocol, and Test connection.
import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  CodeBlock,
  EmptyState,
  Heading,
  Inline,
  Label,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { CONNECTION_INPUTS, TIMING_INPUTS, buildPageState, formToRecord, formatTimestamp, validationView } from './model.js';

const App = () => {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [validation, setValidation] = useState(null);
  const [revealed, setRevealed] = useState({});
  const [envBlock, setEnvBlock] = useState(null);
  const [mcpConfig, setMcpConfig] = useState(null);

  const load = useCallback(async () => {
    try {
      const next = await invoke('fleet.settings.get');
      setPayload(next);
      setError(null);
    } catch (err) {
      setError(err?.message || String(err));
    }
  }, []);

  useEffect(() => {
    // The resolver reads the project from the request context, so the page does
    // not have to wait for useProductContext to load before asking.
    load();
  }, [load]);

  if (error) {
    return (
      <Box padding="space.200">
        <SectionMessage appearance="error" title="The Fleet settings page could not load">
          <Text>{error}</Text>
        </SectionMessage>
      </Box>
    );
  }
  if (!payload) {
    return (
      <Box padding="space.200">
        <Spinner size="medium" label="Loading fleet settings" />
      </Box>
    );
  }

  // buildPageState throws when the resolver returned no record. An uncaught throw
  // during render reaches Jira as a null node, which it reports as the useless
  // "encountered unknown component" with a blank frame. Catch it and explain.
  let state;
  try {
    state = buildPageState(payload);
  } catch (err) {
    return (
      <Box padding="space.200">
        <SectionMessage appearance="error" title="This project has no fleet configuration">
          <Text>{err?.message || String(err)}</Text>
          <Text size="small">
            Open this page as a project administrator and save the connection settings to create the record.
          </Text>
        </SectionMessage>
      </Box>
    );
  }

  return (
    <Box padding="space.200">
      <Stack space="space.300">
        <Stack space="space.100">
          <Heading size="large">Fleet settings</Heading>
          <Text color="color.text.subtle">
            The fleet builds from project {state.project?.key || state.project?.id}. These values are the source of
            truth for this app; the worker receives them as a generated .env below.
          </Text>
          {state.updatedAt ? (
            <Text size="small" color="color.text.subtlest">
              Last saved {formatTimestamp(state.updatedAt)}. A running worker keeps its old values until it restarts.
            </Text>
          ) : null}
        </Stack>

        {state.notice ? (
          <SectionMessage appearance="information" title="Read-only">
            <Text>{state.notice}</Text>
          </SectionMessage>
        ) : null}

        {state.showConfigureCta ? (
          <SectionMessage appearance="discovery" title="Configure the fleet">
            <Text>
              This project has no saved configuration yet. The form is prefilled from environment variables; the first
              save creates the record the app and the worker read from then on.
            </Text>
          </SectionMessage>
        ) : null}

        <SettingsForm
          state={state}
          onSaved={async () => {
            setValidation(null);
            await load();
          }}
          onValidated={(result) => setValidation(validationView(result))}
          onEnvBlock={setEnvBlock}
        />

        {validation ? <ValidationReport validation={validation} /> : null}

        <TokensSection
          state={state}
          revealed={revealed}
          setRevealed={setRevealed}
          onChanged={load}
          onMcpConfig={setMcpConfig}
          onEnvBlock={setEnvBlock}
        />

        <Stack space="space.100">
          <Heading size="medium">Worker configuration</Heading>
          <Text>
            Paste this into the worker's .env. A running worker keeps its old values until it restarts; the timestamp
            above shows when this record last changed. Use a Fleet token's <b>Worker .env</b> action to include the
            optional presence heartbeat token, which is what shows the machine on the Fleet page.
          </Text>
          <CodeBlock
            language="text"
            text={envBlock || state.envBlock || 'Save the configuration to generate the worker .env.'}
          />
        </Stack>

        {mcpConfig ? (
          <Stack space="space.100">
            <Heading size="medium">MCP client configuration</Heading>
            <Text>Add this to a local coding agent's .mcp.json. The URL is your installation's fleet-mcp webtrigger.</Text>
            <CodeBlock language="json" text={mcpConfig} />
          </Stack>
        ) : null}

        <ProtocolSection />
      </Stack>
    </Box>
  );
};

// The form is built from Stack/Textfield/Button rather than the Form family.
// @forge/react's Form, FormSection, FormFooter and useForm are rejected by the
// project-settings renderer ("encountered unknown component"), and one unknown
// node fails the entire page. Plain controlled inputs do the same job here: the
// record shape is flat enough that a form abstraction buys nothing.
function SettingsForm({ state, onSaved, onValidated, onEnvBlock }) {
  const [values, setValues] = useState(() => flatten(state.values));
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const readOnly = !state.canEdit;

  const setField = (name, value) => setValues((prev) => ({ ...prev, [name]: value }));

  const collect = () => formToRecord(values, { record: payloadRecord(state), projectKey: state.project?.key });

  const save = async () => {
    setBusy('save');
    setResult(null);
    try {
      const response = await invoke('fleet.settings.save', { record: collect() });
      if (response?.ok === false) {
        setResult(response);
        return;
      }
      if (response?.workerEnv) onEnvBlock(response.workerEnv);
      await onSaved();
    } catch (err) {
      setResult({ ok: false, error: err?.message || String(err) });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    setResult(null);
    try {
      onValidated(await invoke('fleet.settings.validate', {}));
    } catch (err) {
      setResult({ ok: false, error: err?.message || String(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack space="space.200">
      <Stack space="space.100">
        <Heading size="medium">Connection</Heading>
        <Stack space="space.150">
          {CONNECTION_INPUTS.map((input) => (
            <Box key={input.name}>
              <Label labelFor={`fleet-${input.name}`}>{input.label}</Label>
              <Textfield
                id={`fleet-${input.name}`}
                value={values[input.name] ?? ''}
                onChange={(e) => setField(input.name, e.target.value)}
                isReadOnly={readOnly}
                isMonospaced={input.name !== 'projectKey'}
              />
              <Text size="small" color="color.text.subtlest">
                {input.hint}
              </Text>
            </Box>
          ))}
        </Stack>
      </Stack>

      <Stack space="space.100">
        <Heading size="medium">Worker timings</Heading>
        <Text size="small" color="color.text.subtlest">
          Lease refresh and retry budget are worker-only; the app stores them so the generated .env is complete.
        </Text>
        <Stack space="space.150">
          {TIMING_INPUTS.map((input) => (
            <Box key={input.name}>
              <Label labelFor={`fleet-${input.name}`}>{input.label}</Label>
              <Textfield
                id={`fleet-${input.name}`}
                type="number"
                value={values[input.name] ?? ''}
                onChange={(e) => setField(input.name, e.target.value)}
                isReadOnly={readOnly}
              />
              <Text size="small" color="color.text.subtlest">
                {input.hint}
              </Text>
            </Box>
          ))}
        </Stack>
      </Stack>

      {result && result.ok === false ? (
        <SectionMessage appearance="error" title="Not saved">
          <Stack space="space.100">
            <Text>{result.error || 'The configuration failed its checks.'}</Text>
            {(result.checks || [])
              .filter((c) => !c.ok)
              .map((check) => (
                <Text key={check.id} size="small">
                  {`${check.id}: ${check.lines.join(' ')}`}
                </Text>
              ))}
          </Stack>
        </SectionMessage>
      ) : null}

      <Inline space="space.100">
        <Button appearance="subtle" onClick={test} isDisabled={readOnly || busy !== null}>
          {busy === 'test' ? 'Testing…' : 'Test connection'}
        </Button>
        <Button appearance="primary" onClick={save} isDisabled={readOnly || busy !== null}>
          {busy === 'save' ? 'Saving…' : 'Save'}
        </Button>
      </Inline>
    </Stack>
  );
}

// The record is nested (fields.worker, timings.leaseRefreshMs); the inputs are
// addressed by dotted name, so the form works on one flat object.
function flatten(values = {}) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    if (value && typeof value === 'object') {
      for (const [inner, innerValue] of Object.entries(value)) out[`${key}.${inner}`] = innerValue;
    } else {
      out[key] = value;
    }
  }
  return out;
}

// The form edits the nested record shape; carrying the saved token metadata
// through it means the form does not have to know tokens exist.
function payloadRecord(state) {
  return {
    projectKey: state.project?.key,
    fields: { ...state.values.fields },
    timings: { ...state.values.timings },
    worker: { ...state.values.worker },
  };
}

function ValidationReport({ validation }) {
  return (
    <SectionMessage
      appearance={validation.ok ? 'success' : 'error'}
      title={validation.ok ? 'Connection ok' : 'Connection failed'}
    >
      <Stack space="space.050">
        {validation.lines.map((line, i) => (
          <Text key={i} size="small">
            {line.trim()}
          </Text>
        ))}
      </Stack>
    </SectionMessage>
  );
}

function TokensSection({ state, revealed, setRevealed, onChanged, onMcpConfig, onEnvBlock }) {
  const readOnly = !state.canEdit;
  const [pending, setPending] = useState(false);
  const [pasted, setPasted] = useState({ name: '', value: '' });
  const [error, setError] = useState(null);

  return (
    <Stack space="space.100">
      <Heading size="medium">Fleet tokens</Heading>
      <Text>
        One token per MCP client or worker machine. Tokens authenticate the fleet MCP endpoint and worker heartbeats. A
        token is shown once when generated and can be revealed again here; revoking it immediately stops that client or
        worker.
      </Text>

      {error ? (
        <SectionMessage appearance="error" title="Token action failed">
          <Text>{error}</Text>
        </SectionMessage>
      ) : null}

      {state.tokens.length === 0 ? (
        <EmptyState
          header="No Fleet tokens yet"
          description="Generate one for an MCP client or a worker machine, or paste an existing token to migrate it here."
        />
      ) : (
        <TokenList
          tokens={state.tokens}
          revealed={revealed}
          readOnly={readOnly}
          setError={setError}
          setRevealed={setRevealed}
          onChanged={onChanged}
          onMcpConfig={onMcpConfig}
          onEnvBlock={onEnvBlock}
        />
      )}

      {readOnly ? null : (
        <Inline space="space.100">
          <Button
            appearance="primary"
            isDisabled={pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await invoke('fleet.settings.tokens.generate', { name: 'token' });
                await onChanged();
              } catch (err) {
                setError(err?.message || String(err));
              } finally {
                setPending(false);
              }
            }}
          >
            Generate token
          </Button>
          <Button
            appearance="subtle"
            isDisabled={pending || !pasted.value}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await invoke('fleet.settings.tokens.add', { name: pasted.name, value: pasted.value });
                setPasted({ name: '', value: '' });
                await onChanged();
              } catch (err) {
                setError(err?.message || String(err));
              } finally {
                setPending(false);
              }
            }}
          >
            Paste existing
          </Button>
        </Inline>
      )}

      {readOnly ? null : (
        <Inline space="space.100" shouldWrap>
          <Textfield
            placeholder="Token name (e.g. alice-laptop)"
            value={pasted.name}
            onChange={(e) => setPasted((prev) => ({ ...prev, name: e.target.value }))}
          />
          <Textfield
            placeholder="Paste an existing token"
            isMonospaced
            value={pasted.value}
            onChange={(e) => setPasted((prev) => ({ ...prev, value: e.target.value }))}
          />
        </Inline>
      )}
    </Stack>
  );
}

// The token table. Built from Stack/Inline/Text rather than DynamicTable, which
// the project-settings UI Kit renderer rejects ("encountered unknown component").
// Each row is name, created, masked value, then its actions.
function TokenList({ tokens, revealed, readOnly, setError, setRevealed, onChanged, onMcpConfig, onEnvBlock }) {
  return (
    <Stack space="space.150">
      {tokens.map((token) => (
        <Box key={token.id} padding="space.150">
          <Stack space="space.075">
            <Inline space="space.200" shouldWrap>
              <Text weight="medium">{token.name || '(unnamed)'}</Text>
              <Text size="small" color="color.text.subtlest">
                {token.createdAt ? formatTimestamp(token.createdAt) : '—'}
              </Text>
              <Text size="small">{revealed[token.id] || '••••••••'}</Text>
            </Inline>
            <Inline space="space.050" shouldWrap>
              <Button
                appearance="subtle"
                isDisabled={readOnly}
                onClick={async () => {
                  try {
                    const { value } = await invoke('fleet.settings.tokens.reveal', { tokenId: token.id });
                    setRevealed((prev) => ({ ...prev, [token.id]: value }));
                  } catch (err) {
                    setError(err?.message || String(err));
                  }
                }}
              >
                Reveal
              </Button>
              <Button
                appearance="subtle"
                isDisabled={readOnly}
                onClick={async () => {
                  try {
                    await invoke('fleet.settings.tokens.revoke', { tokenId: token.id });
                    await onChanged();
                  } catch (err) {
                    setError(err?.message || String(err));
                  }
                }}
              >
                Revoke
              </Button>
              <Button
                appearance="subtle"
                isDisabled={readOnly}
                onClick={async () => {
                  try {
                    const { json } = await invoke('fleet.settings.mcpClient', { tokenId: token.id });
                    onMcpConfig(json);
                  } catch (err) {
                    setError(err?.message || String(err));
                  }
                }}
              >
                .mcp.json
              </Button>
              <Button
                appearance="subtle"
                isDisabled={readOnly}
                onClick={async () => {
                  try {
                    const { env } = await invoke('fleet.settings.env', { tokenId: token.id });
                    onEnvBlock(env);
                  } catch (err) {
                    setError(err?.message || String(err));
                  }
                }}
              >
                Worker .env
              </Button>
            </Inline>
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

function ProtocolSection() {
  const [protocol, setProtocol] = useState(null);
  useEffect(() => {
    invoke('fleet.settings.protocol').then(setProtocol).catch(() => setProtocol(null));
  }, []);
  if (!protocol) return null;
  return (
    <Stack space="space.100">
      <Heading size="medium">Protocol (read-only)</Heading>
      <Text>
        The worker and this app resolve these names, so they are fixed. Editing one here would break the fleet silently.
      </Text>
      <Inline space="space.100" shouldWrap>
        {protocol.transitions.map((name) => (
          <Lozenge key={name} appearance="information">
            {name}
          </Lozenge>
        ))}
        <Lozenge appearance="success">{protocol.readyLabel}</Lozenge>
      </Inline>
      <Text size="small" color="color.text.subtlest">
        {`Statuses: ${protocol.statuses.join(' · ')}`}
      </Text>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
