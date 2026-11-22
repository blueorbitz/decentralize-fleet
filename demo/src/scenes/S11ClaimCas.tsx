import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import Backdrop from '../components/Backdrop';
import Caption from '../components/Caption';
import Stage from '../components/Stage';
import { useAppear } from '../lib/anim';
import { colors, font } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// The claim as a compare-and-swap, shown as the actual request pair. The loser
// is rejected because the source status has already moved.
export default function S11ClaimCas() {
  const frame = useCurrentFrame();
  const reqIn = useAppear(6, 16, 18);
  const winIn = interpolate(frame, [58, 74], [0, 1], clamp);
  const loseIn = interpolate(frame, [92, 108], [0, 1], clamp);
  const leaseIn = interpolate(frame, [130, 148], [0, 1], clamp);

  return (
    <AbsoluteFill>
      <Backdrop glowX="50%" glowY="42%" />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <Stage scale={1.15}>
          <div style={{ display: 'flex', gap: 26, alignItems: 'stretch' }}>
            <div style={{ ...reqIn, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <RequestCard />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, justifyContent: 'center', width: 460 }}>
              <Outcome
                show={winIn}
                status="201"
                ok
                title="worker-04 wins"
                body="Transition applied. Worker and lease written in the same request."
              />
              <Outcome
                show={loseIn}
                status="400"
                title="worker-11 is rejected"
                body="FLT-101 is no longer Ready for Build. Re-read, then move on."
              />
            </div>
          </div>
        </Stage>

        <div
          style={{
            display: 'flex',
            gap: 18,
            marginTop: 28,
            opacity: leaseIn,
            transform: `translateY(${(1 - leaseIn) * 10}px)`,
          }}
        >
          <Metric value="5 min" label="lease refresh" />
          <Metric value="15 min" label="stale after" />
          <Metric value="2 h" label="run timeout" />
        </div>

        <div style={{ marginTop: 20 }}>
          <Caption delay={112} text="Whoever transitions first wins. That is the whole lock." />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function RequestCard() {
  return (
    <div
      style={{
        width: 700,
        padding: '18px 20px',
        borderRadius: 10,
        backgroundColor: colors.surface,
        border: `1px solid ${colors.line}`,
      }}
    >
      <div style={{ fontFamily: font.mono, fontSize: 12.5, color: colors.textFaint, marginBottom: 10 }}>
        POST /rest/api/3/issue/FLT-101/transitions
      </div>
      <pre
        style={{
          margin: 0,
          fontFamily: font.mono,
          fontSize: 14.5,
          lineHeight: 1.75,
          color: '#C9D6EA',
          whiteSpace: 'pre',
        }}
      >
        {`{
  "transition": { "id": "31" },   `}
        <span style={{ color: colors.textFaint }}>// Claim</span>
        {`
  "fields": {
    "customfield_10213": "worker-04",`}
        <span style={{ color: colors.textFaint }}>  // Fleet Worker</span>
        {`
    "customfield_10214": "2026-11-21T10:02:14Z"`}
        <span style={{ color: colors.textFaint }}>  // Fleet Lease</span>
        {`
  }
}`}
      </pre>
    </div>
  );
}

function Outcome({
  show,
  status,
  ok,
  title,
  body,
}: {
  show: number;
  status: string;
  ok?: boolean;
  title: string;
  body: string;
}) {
  const tone = ok ? colors.green : colors.amber;
  return (
    <div
      style={{
        opacity: show,
        transform: `translateY(${(1 - show) * 8}px)`,
        padding: '14px 16px',
        borderRadius: 9,
        backgroundColor: colors.surface,
        border: `1px solid ${colors.line}`,
        borderLeft: `3px solid ${tone}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span
          style={{
            padding: '1px 7px',
            borderRadius: 3,
            backgroundColor: ok ? 'rgba(54,179,126,0.16)' : 'rgba(255,171,0,0.14)',
            fontFamily: font.mono,
            fontSize: 12,
            color: tone,
          }}
        >
          HTTP {status}
        </span>
        <span style={{ fontSize: 16, fontWeight: 600, color: colors.text }}>{title}</span>
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.45, color: colors.textMuted }}>{body}</div>
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        padding: '12px 22px',
        borderRadius: 10,
        backgroundColor: 'rgba(255,255,255,0.04)',
        border: `1px solid ${colors.line}`,
        textAlign: 'center',
      }}
    >
      <div style={{ fontFamily: font.mono, fontSize: 22, color: colors.text }}>{value}</div>
      <div style={{ fontSize: 12.5, color: colors.textFaint, marginTop: 2 }}>{label}</div>
    </div>
  );
}
