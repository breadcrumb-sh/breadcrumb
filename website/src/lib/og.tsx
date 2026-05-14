import type { ReactNode } from "react";

const bg = "#121213";
const fg = "#f5f5f6";
const muted = "#b4b4b5";
const subtle = "#6c6c6d";
const border = "#282829";
const surface = "#1b1b1c";

function BreadLogo({ height = 28 }: { height?: number }) {
  const width = Math.round(height * (584 / 475));
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 584 475"
      fill="none"
    >
      <path
        d="M347.586 0.132512C351.629 -0.38435 360.699 0.787582 366.707 0.642277C395.95 0.167608 425.194 0.0213702 454.443 0.204777C471.505 0.200603 491.006 -0.486215 507.803 1.42548C515.957 2.35401 530.956 8.83657 537.979 13.2097C559.392 26.5431 574.277 48.9316 579.956 73.2907C587.197 104.503 581.628 137.317 564.488 164.39C552.436 183.478 532.473 198.878 510.351 204.073C509.9 204.179 509.575 204.576 509.57 205.04C508.854 265.725 509.976 327.292 510.064 388.024L510.106 436.154C510.106 444.669 511.303 464.238 507.745 472.776C507.71 472.859 507.667 472.934 507.605 472.999C506.819 473.823 504.387 474.787 503.396 474.633C495.268 473.34 487.916 473.455 479.752 473.455L100.083 474.893C96.0618 474.939 93.0122 474.95 89.0805 474.642C88.8362 474.623 88.6047 474.512 88.438 474.333C83.2031 468.69 82.481 463.199 82.4292 455.787C82.3125 439.166 83.0316 422.622 83.0337 406.003L83.4946 262.393L83.5464 223.618C83.5907 218.018 84.0722 210.456 83.7719 204.979C83.7478 204.539 83.4302 204.172 83.0005 204.073C68.1725 200.657 55.5663 195.653 43.1206 186.753C20.6626 170.512 5.56415 146.025 1.13717 118.664C-3.26576 91.2668 5.41683 63.8379 21.9897 41.8171C37.8556 20.7355 64.5663 5.67801 90.5288 1.3747C104.771 0.293016 120.831 0.747659 135.077 0.80341C142.326 0.832089 178.587 -0.339907 183.308 2.34247C183.455 2.42576 183.545 2.55291 183.607 2.70966C185.066 6.40261 182.768 11.458 180.266 14.2097C174.996 20.0417 168.249 23.0493 165.783 31.0358C160.193 49.1346 174.373 69.7589 193.688 69.6628C205.679 69.6034 219.158 58.2429 220.717 46.2438C221.204 42.4985 219.316 39.326 220.679 34.7692C220.717 34.6424 220.781 34.5224 220.873 34.4265C223.1 32.0868 228.861 32.4498 231.625 33.8893C231.766 33.9628 231.884 34.0738 231.966 34.2097C233.517 36.7641 233.036 39.0757 234.001 41.5876C244.629 69.2445 275.036 79.5512 302.343 71.6413C324.986 65.0829 348.394 38.3214 343.668 13.5026C342.522 7.47271 334.833 0.701997 347.586 0.132512Z"
        fill={fg}
      />
    </svg>
  );
}

export function BreadcrumbOgCard({
  eyebrow,
  title,
  description,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  footer: ReactNode;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: bg,
        color: fg,
        padding: "48px",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          border: `1px solid ${border}`,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 28px",
            borderBottom: `1px solid ${border}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <BreadLogo height={28} />
            <div
              style={{
                display: "flex",
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: "-0.02em",
              }}
            >
              Breadcrumb
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 16px",
              border: `1px solid ${border}`,
              background: surface,
              fontSize: 12,
              color: subtle,
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            }}
          >
            {eyebrow}
          </div>
        </div>

        {/* Main content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            flex: 1,
            padding: "40px 32px",
            gap: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 64,
              lineHeight: 1.05,
              fontWeight: 700,
              letterSpacing: "-0.045em",
              textWrap: "balance",
              maxWidth: 960,
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 24,
              lineHeight: 1.5,
              color: muted,
              maxWidth: 800,
            }}
          >
            {description}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 28px",
            borderTop: `1px solid ${border}`,
            background: surface,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 16,
              color: subtle,
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            }}
          >
            {footer}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: 14,
              color: subtle,
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            }}
          >
            Open source LLM observability
          </div>
        </div>
      </div>
    </div>
  );
}
