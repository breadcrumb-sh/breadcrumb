import { twMerge } from "tailwind-merge";

type LogoProps = {
  className?: string;
};

export function Logo({ className }: LogoProps) {
  return (
    <img
      src="/bread_icon.svg"
      alt=""
      width="16"
      height="16"
      className={twMerge("size-4", className)}
    />
  );
}
