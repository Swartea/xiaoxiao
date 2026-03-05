import Link from "next/link";

export function ProjectNav({ id }: { id: string }) {
  const items = [
    { href: "/projects", label: "全部作品" },
    { href: `/projects/${id}/dashboard`, label: "仪表盘" },
    { href: `/projects/${id}/bible`, label: "故事设定" },
    { href: `/projects/${id}/outline`, label: "章节大纲" },
    { href: `/projects/${id}/chapters`, label: "章节管理" },
    { href: `/projects/${id}/characters`, label: "人物关系" },
  ];

  return (
    <nav className="mb-6 flex flex-wrap gap-2">
      {items.map((item) => (
        <Link key={item.href} href={item.href} className="rounded-md bg-white/70 px-3 py-1 text-sm hover:bg-white">
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
