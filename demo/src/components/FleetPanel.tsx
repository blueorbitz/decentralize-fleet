import { colors, font } from '../theme';
import Lozenge from './Lozenge';

export type PanelState = {
  key: string;
  summary: string;
  status: string;
  worker: string | null;
  lease: string | null;
  branch: string | null;
  pr: string | null;
  retry: number;
  acceptanceCriteria: string[];
  log: { stamp: string; text: string; tone?: 'info' | 'ok' | 'warn' }[];
  canDispatch?: boolean;
  canRequeue?: boolean;
  dispatchLabel?: string;
};

// The Fleet issue panel, matching forge-app/src/static/issue-panel. Field order,
// labels and the two buttons are the real ones; the panel never claims.
export default function FleetPanel({
  state,
  width = 720,
  pressed,
}: {
  state: PanelState;
  width?: number;
  pressed?: 'dispatch' | 'requeue' | null;
}) {
  return (
    <div
      style={{
        width,
        padding: '20px 24px 22px',
        backgroundColor: colors.n0,
        fontFamily: font.sans,
        borderRadius: 10,
        border: `1px solid ${colors.n40}`,
        boxShadow: '0 20px 50px rgba(9, 30, 66, 0.18)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: colors.n1000 }}>Fleet</span>
        <Lozenge status={state.status} />
        <span style={{ fontFamily: font.mono, fontSize: 13, color: colors.n500 }}>{state.key}</span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '14px 24px',
          padding: '16px 0',
          borderTop: `1px solid ${colors.n30}`,
          borderBottom: `1px solid ${colors.n30}`,
        }}
      >
        <Field label="Worker">
          {state.worker ? (
            <span style={{ fontFamily: font.mono, fontSize: 14, color: colors.n900 }}>{state.worker}</span>
          ) : (
            <Dash />
          )}
        </Field>
        <Field label="Lease">
          {state.lease ? (
            <span style={{ fontFamily: font.mono, fontSize: 14, color: colors.lozYellowText }}>
              {state.lease}
            </span>
          ) : (
            <Dash />
          )}
        </Field>
        <Field label="Branch">
          {state.branch ? (
            <span style={{ fontFamily: font.mono, fontSize: 13, color: colors.b400 }}>{state.branch}</span>
          ) : (
            <Dash />
          )}
        </Field>
        <Field label="Pull request">
          {state.pr ? (
            <span style={{ fontSize: 14, color: colors.b400 }}>{state.pr}</span>
          ) : (
            <Dash />
          )}
        </Field>
        <Field label="Retry budget">
          <span style={{ fontSize: 14, color: colors.n900 }}>
            {state.retry ? `${state.retry} used` : '0 used'}
          </span>
        </Field>
        <Field label="Status">
          <span style={{ fontSize: 14, color: colors.n900 }}>{state.status}</span>
        </Field>
      </div>

      <div style={{ paddingTop: 14 }}>
        <div style={labelStyle}>Acceptance criteria</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 8 }}>
          {state.acceptanceCriteria.map((ac) => (
            <div key={ac} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
              <span
                style={{
                  width: 14,
                  height: 14,
                  marginTop: 3,
                  borderRadius: 3,
                  border: `1.5px solid ${colors.n100}`,
                  backgroundColor: colors.n0,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 13.5, lineHeight: 1.4, color: colors.n800 }}>{ac}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ paddingTop: 16 }}>
        <div style={labelStyle}>Run log — tail</div>
        <pre
          style={{
            margin: '8px 0 0',
            padding: '11px 13px',
            borderRadius: 6,
            backgroundColor: colors.n10,
            border: `1px solid ${colors.n30}`,
            fontFamily: font.mono,
            fontSize: 12.5,
            lineHeight: 1.62,
            color: colors.n800,
            whiteSpace: 'pre-wrap',
            minHeight: 62,
          }}
        >
          {state.log.length === 0
            ? 'No run yet — a worker will claim this ticket once it is Ready for Build.'
            : state.log.map((l, i) => (
                <div
                  key={i}
                  style={{
                    color:
                      l.tone === 'ok'
                        ? colors.lozGreenText
                        : l.tone === 'warn'
                          ? colors.lozYellowText
                          : colors.n800,
                  }}
                >
                  <span style={{ color: colors.n500 }}>{l.stamp} </span>
                  {l.text}
                </div>
              ))}
        </pre>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        {state.canDispatch ? (
          <button style={buttonStyle('primary', pressed === 'dispatch')}>
            {state.dispatchLabel || 'Dispatch to fleet'}
          </button>
        ) : null}
        {state.canRequeue ? (
          <button style={buttonStyle('danger', pressed === 'requeue')}>Abort &amp; requeue</button>
        ) : null}
        {!state.canDispatch && !state.canRequeue ? (
          <span style={{ fontSize: 12.5, color: colors.n500 }}>
            No action available in {state.status}.
          </span>
        ) : null}
      </div>
    </div>
  );
}

const labelStyle = {
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase' as const,
  color: colors.n500,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ ...labelStyle, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, color: colors.n900 }}>{children}</div>
    </div>
  );
}

function Dash() {
  return <span style={{ color: colors.n100 }}>—</span>;
}

function buttonStyle(kind: 'primary' | 'danger', pressed: boolean): React.CSSProperties {
  const bg = kind === 'primary' ? colors.b400 : colors.red;
  return {
    padding: '7px 15px',
    borderRadius: 4,
    border: 'none',
    backgroundColor: pressed ? colors.n800 : bg,
    color: colors.n0,
    fontSize: 13.5,
    fontWeight: 600,
    fontFamily: font.sans,
    boxShadow: pressed ? 'inset 0 1px 3px rgba(0,0,0,0.4)' : 'none',
  };
}
