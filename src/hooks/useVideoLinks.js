import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

// Exercise demo-video links, keyed by exercise_id — fetched once and shared
// by any screen that lists exercises (Preview, Run) so each only needs a
// simple lookup rather than its own catalog fetch.
export function useVideoLinks() {
  const [links, setLinks] = useState({});

  useEffect(() => {
    api("trainer", "list-exercises", {})
      .then((res) => {
        const map = {};
        for (const ex of res.exercises || []) if (ex.video_url) map[ex.id] = ex.video_url;
        setLinks(map);
      })
      .catch(() => {});
  }, []);

  return links;
}
