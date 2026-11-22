import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import Backdrop from '../components/Backdrop';
import Caption from '../components/Caption';
import Board from '../components/Board';
import FleetPanel from '../components/FleetPanel';
import Frame from '../components/Frame';
import Stage from '../components/Stage';
import { useAppear } from '../lib/anim';
import { BOARD_TICKETS, PANEL_BASE } from '../lib/story';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// Dispatch: the button moves the ticket to Ready for Build and stops. It never
// claims — that stays a worker's transition.
export default function S05Dispatch() {
  const frame = useCurrentFrame();
  const boardIn = useAppear(4, 16, 20);
  const panelIn = useAppear(10, 16, 20);

  const pressAt = 96;
  const pressed = frame >= pressAt && frame < pressAt + 8;
  const dispatched = frame >= pressAt + 6;

  const tickets = BOARD_TICKETS.map((t) =>
    t.key === 'FLT-101'
      ? {
          ...t,
          status: dispatched ? 'Ready for Build' : 'Triaged',
          labels: dispatched ? ['fleet-ready'] : t.labels,
        }
      : t,
  );

  const banner = interpolate(frame, [pressAt + 8, pressAt + 20], [0, 1], clamp);

  return (
    <AbsoluteFill>
      <Backdrop glowX="50%" glowY="42%" />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <Stage scale={1.16}>
          <div style={{ display: 'flex', gap: 30, alignItems: 'flex-start' }}>
            <div style={{ ...boardIn, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Frame url="captain-sage.atlassian.net/jira/software/projects/FLT/boards/1" host="Jira">
                <div style={{ padding: 20 }}>
                  <Board tickets={tickets} highlight="FLT-101" width={660} />
                </div>
              </Frame>
            </div>

            <div style={{ ...panelIn, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Frame url="captain-sage.atlassian.net/browse/FLT-101" host="Jira">
                <FleetPanel
                  width={540}
                  pressed={pressed ? 'dispatch' : null}
                  state={{
                    ...PANEL_BASE,
                    status: dispatched ? 'Ready for Build' : 'Triaged',
                    canDispatch: !dispatched,
                    dispatchLabel: 'Dispatch to fleet',
                  }}
                />
              </Frame>
              <div
                style={{
                  opacity: banner,
                  padding: '11px 15px',
                  borderRadius: 8,
                  backgroundColor: 'rgba(76,154,255,0.12)',
                  border: '1px solid rgba(76,154,255,0.4)',
                  fontSize: 15,
                  color: '#B7D4FF',
                }}
              >
                Fleet-ready. A worker will claim this on its next poll (~30–60s).
              </div>
            </div>
          </div>
        </Stage>

        <div style={{ marginTop: 26 }}>
          <Caption delay={118} text="Moved to Ready for Build — and no further. The panel never claims." />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
