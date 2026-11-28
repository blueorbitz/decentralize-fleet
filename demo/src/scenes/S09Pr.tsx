import Take from '../components/Take';

// The pull request the fleet opened, written for a reviewer: what changed, the
// test result, and the stated boundary — a human merges.
export default function S09Pr() {
  return (
    <Take
      take="pr"
      lead={3}
      caption="Opened by the fleet. Reviewed, and merged, by a person."
      captionDelay={70}
    />
  );
}
