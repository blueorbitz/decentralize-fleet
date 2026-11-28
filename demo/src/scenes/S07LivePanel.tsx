import Take from '../components/Take';

// The live claim: a real worker holds the ticket, its lease is counting down,
// and Abort & requeue is one click away.
export default function S07LivePanel() {
  return (
    <Take
      take="panelLive"
      lead={4.5}
      lift={0}
      caption="Worker, lease, branch, PR — and the run log as the audit trail."
      captionDelay={80}
    />
  );
}
