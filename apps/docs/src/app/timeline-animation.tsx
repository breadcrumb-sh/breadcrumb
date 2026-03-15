"use client";

import { useEffect } from "react";

const COLORS = {
  amber: "#58508d",
  teal: "#b4558d",
  violet: "#e77371",
  pink: "#7b6aad",
} as const;

const SEQS = [
  [
    ["teal", 0, 13, 240],
    ["amber", 16, 81, 840],
  ],
  [
    ["amber", 0, 19, 340],
    ["teal", 22, 7, 110],
    ["teal", 31, 5, 80],
    ["amber", 38, 59, 720],
  ],
  [["amber", 2, 94, 400]],
  [
    ["violet", 0, 45, 440],
    ["pink", 49, 48, 500],
  ],
  [
    ["teal", 0, 4, 60],
    ["amber", 7, 90, 980],
  ],
  [
    ["teal", 0, 9, 150],
    ["amber", 12, 85, 860],
  ],
  [
    ["violet", 0, 14, 260],
    ["teal", 17, 6, 100],
    ["teal", 25, 6, 100],
    ["amber", 33, 64, 760],
  ],
] as const;

type RowSequence = (typeof SEQS)[number];

export function TimelineAnimation() {
  useEffect(() => {
    const rowsEl = document.getElementById("tl-rows");
    if (!rowsEl) return;

    rowsEl.replaceChildren();

    const timeouts: number[] = [];
    let cancelled = false;
    const rowContainers: HTMLDivElement[] = [];

    const raf2 = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const timeout = window.setTimeout(() => resolve(), ms);
        timeouts.push(timeout);
      });

    for (let i = 0; i < 5; i++) {
      const row = document.createElement("div");
      row.style.cssText = "position:relative;height:26px;";
      const track = document.createElement("div");
      track.style.cssText = "position:absolute;inset:0;background:#1b1b1c;";
      row.appendChild(track);
      rowsEl.appendChild(row);
      rowContainers.push(row);
    }

    async function animateRow(row: HTMLDivElement, startIdx: number) {
      let idx = startIdx;

      while (!cancelled) {
        const seq: RowSequence = SEQS[idx % SEQS.length];
        idx++;
        const blockEls: HTMLDivElement[] = [];

        for (const [color, startPct, widthPct, growMs] of seq) {
          if (cancelled) return;

          const block = document.createElement("div");
          block.style.cssText = [
            "position:absolute",
            "top:3px",
            "bottom:3px",
            `left:${startPct}%`,
            `width:${widthPct}%`,
            `background:${COLORS[color]}`,
            "transform:scaleX(0)",
            "transform-origin:left center",
            "will-change:transform",
          ].join(";");
          row.appendChild(block);
          blockEls.push(block);
          await raf2();
          if (cancelled) return;
          block.style.transition = `transform ${growMs}ms cubic-bezier(0.2, 0, 0.05, 1)`;
          block.style.transform = "scaleX(1)";
          await sleep(growMs + 20);
        }

        await sleep(1600);
        blockEls.forEach((block) => {
          block.style.transition = "opacity 0.32s ease";
          block.style.opacity = "0";
        });
        await sleep(380);
        blockEls.forEach((block) => block.remove());
        await sleep(200);
      }
    }

    rowContainers.forEach((row, i) => {
      const timeout = window.setTimeout(() => {
        void animateRow(row, i);
      }, i * 1350);
      timeouts.push(timeout);
    });

    return () => {
      cancelled = true;
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
      rowsEl.replaceChildren();
    };
  }, []);

  return null;
}
