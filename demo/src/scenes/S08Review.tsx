import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import Backdrop from '../components/Backdrop';
import Caption from '../components/Caption';
import FleetPanel from '../components/FleetPanel';
import Frame from '../components/Frame';
import { useAppear } from '../lib/anim';
import { colors, font } from '../theme';
import { PANEL_BASE, RUN_LOG, TICKET } from '../lib/story';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// The human gate: a finished PR on one side, the ticket in In Review on the
// other. The fleet stops here.
export default function S08Review() {
  const frame = useCurrentFrame();
  const prIn = useAppear(4, 18, 22);
  const panelIn = useAppear(24, 18, 22);
  const check = interpolate(frame, [60, 78], [0, 1], clamp);
  const mergeHint = interpolate(frame, [150, 175], [0, 1], clamp);

  return (
    <AbsoluteFill>
      <Backdrop glowX="50%" glowY="42%" />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
          <div style={prIn}>
            <Frame url={TICKET.prUrl} host="Bitbucket">
              <PullRequest check={check} />
            </Frame>
          </div>

          <div style={panelIn}>
            <Frame url="captain-sage.atlassian.net/browse/FLT-101" host="Jira">
              <FleetPanel
                width={560}
                state={{
                  ...PANEL_BASE,
                  status: 'In Review',
                  worker: TICKET.workerA,
                  branch: TICKET.branch,
                  pr: TICKET.pr,
                  log: RUN_LOG,
                }}
              />
            </Frame>
          </div>
        </div>

        <div style={{ marginTop: 22, opacity: mergeHint }}>
          <Caption delay={0} text="A human merges. The fleet never does." />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function PullRequest({ check }: { check: number }) {
  return (
    <div style={{ width: 660, padding: '20px 24px', fontFamily: font.sans, backgroundColor: colors.n0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: colors.n1000 }}>
          FLT-101: {TICKET.summary}
        </span>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 3,
            backgroundColor: colors.lozGreen,
            color: colors.lozGreenText,
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          Open
        </span>
      </div>
      <div style={{ fontSize: 13, color: colors.n500, marginBottom: 16 }}>
        captain-sage / fleet-test · {TICKET.branch} → main
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <FileChip name="src/reports/export-csv.ts" add />
        <FileChip name="src/reports/usage.ts" />
        <FileChip name="export-csv.test.ts" add />
      </div>

      <div
        style={{
          padding: '13px 15px',
          borderRadius: 6,
          border: `1px solid ${colors.n30}`,
          backgroundColor: colors.n10,
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 700, color: colors.n700, marginBottom: 9 }}>
          Acceptance criteria
        </div>
        {TICKET.ac.map((ac) => (
          <div key={ac} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
            <span style={{ color: colors.lozGreenText, fontWeight: 700, opacity: check }}>✓</span>
            <span style={{ fontSize: 13, lineHeight: 1.4, color: colors.n800 }}>{ac}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 22 }}>
        <Signal label="Build" value="passing" />
        <Signal label="Tests" value="24 / 24" />
        <Signal label="Auto-merge" value="never" danger />
        <Signal label="Reviewed by" value="a human" />
      </div>
    </div>
  );
}

function FileChip({ name, add }: { name: string; add?: boolean }) {
  return (
    <span
      style={{
        padding: '4px 9px',
        borderRadius: 4,
        backgroundColor: colors.n20,
        border: `1px solid ${colors.n40}`,
        fontFamily: font.mono,
        fontSize: 12,
        color: add ? colors.lozGreenText : colors.n700,
      }}
    >
      {name}
    </span>
  );
}

function Signal({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: colors.n500, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: danger ? colors.red : colors.lozGreenText }}>
        {value}
      </div>
    </div>
  );
}
