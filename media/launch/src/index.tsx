import React from "react";
import {
  registerRoot,
  Composition,
  AbsoluteFill,
  Sequence,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
} from "remotion";
import storyboard from "../storyboard.json";

const FPS = storyboard.format.fps;
const WIDTH = storyboard.format.width;
const HEIGHT = storyboard.format.height;

type SceneText = { content: string; role: string };
type Scene = {
  id: string;
  duration: number;
  template: string | null;
  image: string | null;
  text: SceneText[];
  transition: string;
};

const scenes = storyboard.scenes as Scene[];
const totalFrames = scenes.reduce((sum, s) => sum + Math.round(s.duration * FPS), 0);

const TitleCard: React.FC<{ texts: SceneText[] }> = ({ texts }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const title = texts.find((t) => t.role === "title");
  const subtitle = texts.find((t) => t.role === "subtitle");
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0d1117",
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <h1 style={{ color: "#fff", fontSize: 96, fontFamily: "Arial Black, sans-serif", margin: 0 }}>
        {title?.content}
      </h1>
      {subtitle ? (
        <p style={{ color: "#8b949e", fontSize: 44, fontFamily: "Arial, sans-serif", marginTop: 24 }}>
          {subtitle.content}
        </p>
      ) : null}
    </AbsoluteFill>
  );
};

const MemeCard: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const slideIn = interpolate(frame, [0, 10], [WIDTH, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const x = scene.transition === "slide-left" ? slideIn : 0;
  const opacity = scene.transition === "fade" ? interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" }) : 1;
  const caption = scene.text.find((t) => t.role === "caption");
  return (
    <AbsoluteFill style={{ backgroundColor: "#0d1117", transform: `translateX(${x}px)`, opacity }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 60, bottom: 120 }}>
        {scene.image ? (
          <Img
            src={staticFile(scene.image.replace(/^assets\//, ""))}
            style={{ maxWidth: WIDTH - 120, maxHeight: HEIGHT - 260, objectFit: "contain" }}
          />
        ) : null}
      </AbsoluteFill>
      {caption ? (
        <div
          style={{
            position: "absolute",
            bottom: 40,
            width: "100%",
            textAlign: "center",
            color: "#fff",
            fontSize: 42,
            fontFamily: "Arial, sans-serif",
          }}
        >
          {caption.content}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const Launch: React.FC = () => {
  let offset = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: "#0d1117" }}>
      {scenes.map((scene) => {
        const durationInFrames = Math.round(scene.duration * FPS);
        const from = offset;
        offset += durationInFrames;
        return (
          <Sequence key={scene.id} from={from} durationInFrames={durationInFrames}>
            {scene.image ? <MemeCard scene={scene} /> : <TitleCard texts={scene.text} />}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const Root: React.FC = () => (
  <Composition
    id="Launch"
    component={Launch}
    durationInFrames={totalFrames}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);

registerRoot(Root);
