import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="font-heading text-4xl">Novel Factory</h1>
      <p className="mt-3 text-black/70">结构化记忆驱动的小说生产软件</p>
      <div className="mt-6">
        <Link className="rounded-md bg-ink px-4 py-2 text-paper" href="/projects">
          进入项目列表
        </Link>
      </div>
    </main>
  );
}
