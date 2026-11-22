import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import Backdrop from '../components/Backdrop';
import Caption from '../components/Caption';
import Frame from '../components/Frame';
import Stage from '../components/Stage';
import { useAppear } from '../lib/anim';
import { colors, font } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// The Fleet settings page (docs/grill/fleet-settings-page.md): Connection,
// Worker timings, MCP tokens, Worker configuration, Test connection.
//
// This is a faux UI: the real page is being built separately. When it ships,
// swap <SettingsBody /> for a <Footage src="settings.mp4" /> and nothing else
// in the scene changes.
export default function S09Settings() {
  const frame = useCurrentFrame();
  const bodyIn = useAppear(4, 18, 24);
  const pressedAt = 132;
  const pressed = frame >= pressedAt && frame < pressedAt + 8;
  const testRan = interpolate(frame, [pressedAt + 8, pressedAt + 26], [0, 1], clamp);

  return (
    <AbsoluteFill>
      <Backdrop glowX="52%" glowY="40%" />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <Stage scale={1.0}>
          <div style={bodyIn}>
            <Frame
              url="captain-sage.atlassian.net/jira/software/projects/FLT/settings/fleet"
              host="Jira settings"
              style={{ width: 1560 }}
            >
              <SettingsBody pressed={pressed} testRan={testRan} />
            </Frame>
          </div>
        </Stage>

        <div style={{ marginTop: 24 }}>
          <Caption delay={28} text="Project settings → Fleet settings. Saved in Jira, not in a developer's shell." />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function SettingsBody({ pressed, testRan }: { pressed: boolean; testRan: number }) {
  return (
    <div style={{ display: 'flex', width: '100%', height: 700, backgroundColor: colors.n0 }}>
      <Sidebar />
      <div style={{ flex: 1, padding: '26px 34px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <span style={{ fontSize: 23, fontWeight: 700, color: colors.n1000 }}>Fleet settings</span>
          <span style={{ fontSize: 13, color: colors.n500 }}>FLT · Project settings</span>
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: colors.n600, marginBottom: 20 }}>
          Configure how the fleet coordinates this project. Changes are stored in Jira and
          emitted as a worker config you paste on any machine.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <Card title="Connection" delay={8}>
            <Row label="Project key" value="FLT" />
            <Row label="Fleet Worker" value="customfield_10213" mono />
            <Row label="Fleet Lease" value="customfield_10214" mono />
            <Row label="Fleet Branch" value="customfield_10215" mono />
            <Row label="Fleet PR" value="customfield_10216" mono />
            <Row label="Fleet Retry" value="customfield_10217" mono />
          </Card>

          <Card title="Worker timings" delay={14}>
            <Row label="Lease refresh" value="5 minutes" />
            <Row label="Lease stale" value="15 minutes" />
            <Row label="Retry budget" value="1" />
            <Note text="Also lives in the worker's .env. Changing this page does not restart a running worker." />
          </Card>

          <Card title="MCP tokens" delay={20}>
            <TokenRow name="claude-code-laptop" created="2026-11-18" />
            <TokenRow name="ci-runner" created="2026-11-20" />
            <Note text="Per-project and revocable. A token binds its caller to this project." />
          </Card>

          <Card title="Worker configuration" delay={26}>
            <div
              style={{
                fontFamily: font.mono,
                fontSize: 11.5,
                lineHeight: 1.65,
                color: colors.n800,
                padding: '10px 12px',
                borderRadius: 5,
                backgroundColor: colors.n10,
                border: `1px solid ${colors.n30}`,
                whiteSpace: 'pre',
              }}
            >
              {`JIRA_URL=https://acme.atlassian.net
JIRA_PROJECT=FLT
FLEET_WORKER_ID=worker-04
FLEET_ADAPTER=opencode
FLEET_LEASE_STALE_MS=900000`}
            </div>
            <Note text="Copy into .env on any machine, then start the worker." />
          </Card>
        </div>

        <div
          style={{
            marginTop: 18,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '13px 16px',
            borderRadius: 6,
            border: `1px solid ${colors.n30}`,
            backgroundColor: colors.n10,
          }}
        >
          <button style={testButton(pressed)}>Test connection</button>
          <div style={{ display: 'flex', gap: 18, opacity: testRan }}>
            <Check ok label="Project" />
            <Check ok label="5 fields" />
            <Check ok label="Statuses" />
            <Check ok label="Claim transition" />
          </div>
          {testRan < 0.05 ? (
            <span style={{ fontSize: 12.5, color: colors.n500 }}>
              Re-runs the same checks as verify-setup
            </span>
          ) : null}
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button style={ghostButton}>Cancel</button>
          <button style={primaryButton}>Save</button>
        </div>
        <div style={{ marginTop: 8, textAlign: 'right', fontFamily: font.mono, fontSize: 11, color: colors.n200 }}>
          2026-11-21 09:14
        </div>
      </div>
    </div>
  );
}

function Sidebar() {
  const items = ['General', 'Fleet settings', 'Permissions', 'Notifications'];
  return (
    <div
      style={{
        width: 230,
        padding: '22px 14px',
        backgroundColor: colors.n10,
        borderRight: `1px solid ${colors.n40}`,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: colors.n500, padding: '0 10px 10px' }}>
        PROJECT SETTINGS
      </div>
      {items.map((item) => (
        <div
          key={item}
          style={{
            padding: '8px 10px',
            borderRadius: 4,
            marginBottom: 2,
            fontSize: 13.5,
            color: item === 'Fleet settings' ? colors.b400 : colors.n700,
            backgroundColor: item === 'Fleet settings' ? colors.b50 : 'transparent',
            fontWeight: item === 'Fleet settings' ? 600 : 400,
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

function Card({ title, children, delay }: { title: string; children: React.ReactNode; delay: number }) {
  const appear = useAppear(delay, 14, 12);
  return (
    <div
      style={{
        ...appear,
        padding: '14px 16px',
        borderRadius: 7,
        border: `1px solid ${colors.n30}`,
        backgroundColor: colors.n0,
      }}
    >
      <div style={{ fontSize: 14.5, fontWeight: 700, color: colors.n1000, marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{children}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 12.5, color: colors.n600 }}>{label}</span>
      <span
        style={{
          fontSize: 12.5,
          color: colors.n900,
          fontFamily: mono ? font.mono : font.sans,
          fontWeight: mono ? 400 : 600,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function TokenRow({ name, created }: { name: string; created: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 0',
        borderBottom: `1px solid ${colors.n20}`,
      }}
    >
      <span style={{ fontFamily: font.mono, fontSize: 12.5, color: colors.n900, flex: 1 }}>{name}</span>
      <span style={{ fontSize: 11.5, color: colors.n400 }}>{created}</span>
      <span style={{ fontSize: 11.5, color: colors.b400, fontWeight: 600 }}>Reveal</span>
      <span style={{ fontSize: 11.5, color: colors.red, fontWeight: 600 }}>Revoke</span>
    </div>
  );
}

function Note({ text }: { text: string }) {
  return <div style={{ fontSize: 11.5, lineHeight: 1.45, color: colors.n500 }}>{text}</div>;
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: colors.lozGreenText }}>
      <span style={{ fontWeight: 700 }}>{ok ? '✓' : '×'}</span>
      {label}
    </span>
  );
}

function testButton(pressed: boolean): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: 4,
    border: `1px solid ${colors.n40}`,
    backgroundColor: pressed ? colors.n30 : colors.n0,
    fontSize: 13,
    fontWeight: 600,
    color: colors.n800,
    fontFamily: font.sans,
  };
}

const ghostButton: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 4,
  border: '1px solid rgba(9,30,66,0)',
  backgroundColor: 'transparent',
  fontSize: 13,
  fontWeight: 600,
  color: colors.n700,
  fontFamily: font.sans,
};

const primaryButton: React.CSSProperties = {
  padding: '6px 16px',
  borderRadius: 4,
  border: 'none',
  backgroundColor: colors.b400,
  fontSize: 13,
  fontWeight: 600,
  color: colors.n0,
  fontFamily: font.sans,
};
