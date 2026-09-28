import { useEffect, useMemo, useState } from "react";
import LessonTrack from "./LessonTrack";
import {
  loadOgsSection,
  toLesson,
  type OgsIndex,
  type OgsSection,
} from "./ogsLibrary";

/** Every imported Online-Go.com lesson, playable, for choosing what goes in
 * the Study Room's own course. */
export default function LibraryTrack({ index }: { index: OgsIndex }) {
  const [sectionId, setSectionId] = useState(index.sections[0].id);
  const [section, setSection] = useState<OgsSection | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    setFailed(false);
    loadOgsSection(sectionId).then((data) => {
      if (!current) return;
      if (data) setSection(data);
      else setFailed(true);
    });
    return () => {
      current = false;
    };
  }, [sectionId]);

  const lessons = useMemo(
    () => section?.lessons.map(toLesson) ?? [],
    [section],
  );
  const loaded = section?.id === sectionId && lessons.length > 0;

  return (
    <>
      <div className="study-library-bar">
        <label>
          <span className="study-kicker">SECTION</span>
          <select
            value={sectionId}
            onChange={(event) => setSectionId(event.target.value)}
          >
            {index.sections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · {item.lessons} lessons · {item.pages} pages
              </option>
            ))}
          </select>
        </label>
        <span>
          From the <a href={index.source}>Online-Go.com Learning Hub</a> · AGPL
        </span>
      </div>
      {loaded && section ? (
        <LessonTrack
          key={sectionId}
          lessons={lessons}
          storageKey={`surround:ogs:${sectionId}`}
          kicker="IMPORTED FROM ONLINE-GO.COM FOR REVIEW"
          heading={section.title}
          label="LIBRARY"
        />
      ) : (
        <p className="study-library-status" role="status">
          {failed ? "This section hasn't been imported." : "Loading lessons…"}
        </p>
      )}
    </>
  );
}
