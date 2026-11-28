import Take from '../components/Take';

// In Review: branch pushed, PR opened, tests green. The fleet stops here.
export default function S08Review() {
  return (
    <Take
      take="panelReview"
      lead={5}
      lift={0}
      caption="In Review. The fleet never merges — a human does."
      captionDelay={70}
    />
  );
}
