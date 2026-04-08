import { useEffect, useState } from "react";

/** 右侧属性抽屉宽度：窄屏占满余量，宽屏封顶 440 */
export function useDrawerWidth(max = 440, min = 280, gutter = 16): number {
  const [w, setW] = useState(max);
  useEffect(() => {
    function calc() {
      const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
      setW(Math.min(max, Math.max(min, vw - gutter)));
    }
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [max, min, gutter]);
  return w;
}
