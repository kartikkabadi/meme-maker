import React from "react";
import {
  registerRoot,
  Composition,
  AbsoluteFill,
  Sequence,
  Audio,
  Img,
  staticFile,
  delayRender,
  continueRender,
  useCurrentFrame,
  interpolate,
  Easing,
} from "remotion";
import storyboard from "../storyboard.json";

const FPS = storyboard.format.fps;
const WIDTH = storyboard.format.width;
const HEIGHT = storyboard.format.height;

const BG = "#0d1117";
const ENTER_FRAMES = 10;
const EXIT_FRAMES = 8;

let antonPromise: Promise<void> | null = null;
const loadAnton = (): Promise<void> => {
  if (!antonPromise) {
    const anton = new FontFace("Anton", `url(${staticFile("fonts/Anton-Regular.ttf")})`);
    antonPromise = anton.load().then((f) => {
      document.fonts.add(f);
    });
  }
  return antonPromise;
};

const useBrandFont = () => {
  const [handle] = React.useState(() => delayRender("load Anton font"));
  React.useEffect(() => {
    loadAnton()
      .then(() => continueRender(handle))
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("Anton font failed to load, falling back to Arial Black", err);
        continueRender(handle);
      });
  }, [handle]);
};

const BRAND_FONT = "Anton, 'Arial Black', sans-serif";
const TEXT_SHADOW = "0 3px 14px rgba(0,0,0,0.65)";

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

/** 0→1 entrance progress, 1→0 exit progress folded into a single opacity+motion helper. */
const useSceneProgress = (durationInFrames: number, isLast: boolean) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, ENTER_FRAMES], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const exitStart = durationInFrames - (isLast ? 15 : EXIT_FRAMES);
  const exit = interpolate(frame, [exitStart, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  const kenBurns = interpolate(frame, [0, durationInFrames], [1, 1.07], {
    extrapolateRight: "clamp",
  });
  const drift = interpolate(frame, [0, durationInFrames], [0, -18], {
    extrapolateRight: "clamp",
  });
  return { frame, enter, exit, kenBurns, drift };
};

const TitleCard: React.FC<{
  texts: SceneText[];
  durationInFrames: number;
  isLast: boolean;
}> = ({ texts, durationInFrames, isLast }) => {
  const { frame, enter, exit, kenBurns } = useSceneProgress(durationInFrames, isLast);
  const title = texts.find((t) => t.role === "title");
  const subtitle = texts.find((t) => t.role === "subtitle");
  const subOpacity = interpolate(frame, [6, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const subRise = interpolate(frame, [6, 18], [24, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const titleLines = title?.content.includes("/")
    ? [title.content.slice(0, title.content.indexOf("/") + 1), title.content.slice(title.content.indexOf("/") + 1)]
    : [title?.content ?? ""];
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG,
        justifyContent: "center",
        alignItems: "center",
        opacity: enter * exit,
      }}
    >
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          transform: `scale(${kenBurns})`,
          padding: 60,
        }}
      >
        <div style={{ textAlign: "center", maxWidth: WIDTH - 120 }}>
          {titleLines.map((line, i) => (
            <h1
              key={i}
              style={{
                color: "#fff",
                fontSize: titleLines.length > 1 ? 76 : 110,
                lineHeight: 1.15,
                fontFamily: BRAND_FONT,
                letterSpacing: 1,
                margin: 0,
                textShadow: TEXT_SHADOW,
                overflowWrap: "anywhere",
              }}
            >
              {line}
            </h1>
          ))}
          {subtitle ? (
            <p
              style={{
                color: "#9ecbff",
                fontSize: 44,
                fontFamily: "Arial, sans-serif",
                letterSpacing: 0.5,
                marginTop: 32,
                marginBottom: 0,
                opacity: subOpacity,
                transform: `translateY(${subRise}px)`,
                textShadow: TEXT_SHADOW,
              }}
            >
              {subtitle.content}
            </p>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const MemeCard: React.FC<{
  scene: Scene;
  durationInFrames: number;
  isLast: boolean;
}> = ({ scene, durationInFrames, isLast }) => {
  const { frame, enter, exit, kenBurns, drift } = useSceneProgress(durationInFrames, isLast);
  const slideX = (1 - enter) * 90;
  const exitX = (1 - exit) * -70;
  const caption = scene.text.find((t) => t.role === "caption");
  const captionOpacity = interpolate(frame, [5, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const captionRise = interpolate(frame, [5, 15], [26, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const src = scene.image ? staticFile(scene.image.replace(/^assets\//, "")) : null;
  return (
    <AbsoluteFill style={{ backgroundColor: BG, opacity: enter * exit }}>
      {src ? (
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <Img
            src={src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "blur(46px) brightness(0.42) saturate(1.15)",
              transform: `scale(${kenBurns * 1.18})`,
            }}
          />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: 40,
          bottom: 110,
          transform: `translateX(${slideX + exitX}px) scale(${kenBurns})`,
        }}
      >
        {src ? (
          <Img
            src={src}
            style={{
              maxWidth: WIDTH - 140,
              maxHeight: HEIGHT - 240,
              minHeight: HEIGHT * 0.62,
              objectFit: "contain",
              transform: `translateY(${drift}px)`,
              borderRadius: 10,
              boxShadow: "0 14px 60px rgba(0,0,0,0.6)",
            }}
          />
        ) : null}
      </AbsoluteFill>
      {caption ? (
        <div
          style={{
            position: "absolute",
            bottom: 42,
            width: "100%",
            textAlign: "center",
            color: "#fff",
            fontSize: 46,
            fontFamily: BRAND_FONT,
            letterSpacing: 0.8,
            textShadow: TEXT_SHADOW,
            opacity: captionOpacity,
            transform: `translateY(${captionRise}px)`,
          }}
        >
          {caption.content}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const Launch: React.FC = () => {
  useBrandFont();
  let offset = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <Audio src={staticFile("music.mp3")} volume={0.6} />
      {scenes.map((scene, i) => {
        const durationInFrames = Math.round(scene.duration * FPS);
        const from = offset;
        offset += durationInFrames;
        const isLast = i === scenes.length - 1;
        return (
          <Sequence key={scene.id} from={from} durationInFrames={durationInFrames}>
            {scene.image ? (
              <MemeCard scene={scene} durationInFrames={durationInFrames} isLast={isLast} />
            ) : (
              <TitleCard texts={scene.text} durationInFrames={durationInFrames} isLast={isLast} />
            )}
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
