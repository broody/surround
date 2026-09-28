type Props = {
  message: string;
  mood: "lesson" | "hint" | "retry" | "success";
};

const labels = {
  lesson: "YOUR GO MENTOR",
  hint: "A LITTLE GUIDANCE",
  retry: "LET’S LOOK AGAIN",
  success: "WELL PLAYED",
};

export default function MentorDialogue({ message, mood }: Props) {
  return (
    <section className="mentor-dialogue" aria-label="Ayu’s guidance">
      <div className="mentor-portrait">
        <img
          src="/assets/characters/ayu-portrait-v2.png"
          alt="Ayu, your Go teacher, smiling in a teal robe"
          width={1254}
          height={1254}
        />
      </div>
      <div className="mentor-speech min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h2>Ayu</h2>
          <span className="mentor-role">{labels[mood]}</span>
        </div>
        <p role="status" aria-live="polite" aria-atomic="true">{message}</p>
      </div>
    </section>
  );
}
