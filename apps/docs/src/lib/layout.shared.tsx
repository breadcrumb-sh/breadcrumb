import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

function Logo() {
  return (
    <img src="/bread_icon.svg" alt="" width="18" height="18" />
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: 600, letterSpacing: "-0.01em" }}>
          <Logo />
          Breadcrumb
        </span>
      ),
    },
    searchToggle: {
      enabled: true,
    },
    themeSwitch: {
      enabled: false,
    },
  };
}
