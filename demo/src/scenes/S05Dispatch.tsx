import Take from '../components/Take';

// Dispatch: press "Dispatch to fleet" on a Triaged ticket and watch it move to
// Ready for Build. The panel never claims on the worker's behalf.
export default function S05Dispatch() {
  return (
    <Take
      take="dispatch"
      lead={11}
      lift={0}
      caption="Dispatch moves it to Ready for Build — and stops there."
      captionDelay={50}
    />
  );
}
