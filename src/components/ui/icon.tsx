import type { SVGProps } from "react";
const paths = {
  search: "m21 21-4.5-4.5 M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0",
  bag: "M5 7h14l1 14H4L5 7Z M9 8V6a3 3 0 0 1 6 0v2",
  user: "M20 21v-2a7 7 0 0 0-14 0v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  home: "m3 10 9-7 9 7v11h-6v-7H9v7H3V10Z",
  plus: "M12 5v14 M5 12h14",
  close: "m6 6 12 12 M6 18 18 6",
  menu: "M5 5h14v16H5V5Z M9 2v5 M15 2v5 M9 11h6 M9 15h6",
  arrow: "M4 12h16 m-6-6 6 6-6 6",
  whatsapp: "M20.5 11.7a8.5 8.5 0 0 1-12.7 7.4L3 21l1.7-4.9A8.5 8.5 0 1 1 20.5 11.7Z M8 7c-1 4 3 8 7 8l1-2-3-1-1 1-2-2 1-1-1-3H8Z",
};
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}
