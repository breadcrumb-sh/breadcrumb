import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

function Logo() {
  return (
    <img src="/bread_icon.svg" alt="" width="20" height="20" />
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <Logo />
          Breadcrumb
        </>
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
