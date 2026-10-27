import type { Point } from "./simulation";

// A low, intimate camera, aimed below the face so the actor sits above the dialogue panel.
export function conversationFraming(subject: Point, aspect: number) {
  return {
    position: { x: subject.x + 2.2, y: 2.05, z: subject.z + 4.2 },
    lookAt: { x: subject.x, y: 0.7, z: subject.z },
    view: aspect < 0.8 ? 1.38 : 1.18,
  };
}
