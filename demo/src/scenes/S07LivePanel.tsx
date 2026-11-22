import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import Backdrop from '../components/Backdrop';
import Caption from '../components/Caption';
import FleetPanel from '../components/FleetPanel';
import Frame from '../components/Frame';
import { useAppear } from '../lib/anim';
import { colors, font } from '../theme';
import { PANEL_BASE, RUN_LOG, TICKET } from '../lib/story';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// The live claim: worker id, a lease counting down, and the run log filling in.
export default function S07LivePanel() {
  const frame = useCurrentFrame();
  const panelIn = useAppear(4, 16, 22);

  // Lease counts down from 15:00; the log reveals line by line.
  const remaining = Math.max(0, 15 * 60 - Math.floor(frame / 30) * 7);
  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, '0');

  const visibleLog = Math.min(RUN_LOG.length, Math.floor(interpolate(frame, [30, 150], [0, RUN_LOG.length], clamp)) + 1);

  return (
    <AbsoluteFill>
      <Backdrop glowX="54%" glowY="42%" />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 30, alignItems: 'flex-start' }}>
          <div style={{ ...panelIn }}>
            <Frame url="captain-sage.atlassian.net/browse/FLT-101" host="Jira">
              <FleetPanel
                width={600}
                state={{
                  ...PANEL_BASE,
                  status: 'In Build',
                  worker: TICKET.workerA,
                  lease: `${mm}:${ss} left of 15m`,
                  branch: TICKET.branch,
                  canRequeue: true,
                  log: RUN_LOG.slice(0, visibleLog),
                }}
              />
            </Frame>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: 380 }}>
            <Note delay={16} title="Lease" body="Refreshed every 5 minutes while the run is alive." tone={colors.amber} />
            <Note delay={26} title="Run log" body="Written as Jira comments — the ticket history is the audit trail." tone={colors.accent} />
            <Note delay={36} title="Abort & requeue" body="One human click, or the scheduled reaper if the lease goes stale." tone={colors.red} />
          </div>
        </div>

        <div style={{ marginTop: 26 }}>
          <Caption delay={110} text="Who holds it, how long they hold it, and what they have done." />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Note({
  delay,
  title,
  body,
  tone,
}: {
  delay: number;
  title: string;
  body: string;
  tone: string;
}) {
  const appear = useAppear(delay, 16, 14);
  return (
    <div
      style={{
        ...appear,
        padding: '14px 16px',
        borderRadius: 9,
        backgroundColor: colors.surface,
        border: `1px solid ${colors.line}`,
        borderLeft: `3px solid ${tone}`,
      }}
    >
      <div style={{ fontFamily: font.mono, fontSize: 12, letterSpacing: '0.1em', color: tone, marginBottom: 5 }}>
        {title.toUpperCase()}
      </div>
      <div style={{ fontSize: 15, lineHeight: 1.45, color: colors.textMuted }}>{body}</div>
    </div>
  );
}
