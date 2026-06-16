"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavBar() {
  const pathname = usePathname();
  const onMDP = !pathname.startsWith("/referral");

  return (
    <nav className="app-nav">
      <Link
        href="/"
        className={`app-nav__link${onMDP ? "" : " app-nav__link--dim"}`}
        aria-current={onMDP ? "page" : undefined}
      >
        Medical Desert Planner
      </Link>
      <Link
        href="/referral"
        className={`app-nav__link${!onMDP ? "" : " app-nav__link--dim"}`}
        aria-current={!onMDP ? "page" : undefined}
      >
        Maya
      </Link>
    </nav>
  );
}
