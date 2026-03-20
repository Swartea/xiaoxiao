"use client";

import { AuthorAdvisorPanel } from "@/components/chapter-workspace/author-advisor-panel";
import { ContextPanel } from "@/components/chapter-workspace/context-panel";
import { DiagnosticsPanel } from "@/components/chapter-workspace/diagnostics-panel";
import { EditorPanel } from "@/components/chapter-workspace/editor-panel";
import { useChapterWorkspace } from "@/components/chapter-workspace/use-chapter-workspace";
import { ProjectNav } from "@/components/project-nav";

type Props = { params: Promise<{ id: string; no: string }> };

export default function ChapterWorkspacePage({ params }: Props) {
  const controller = useChapterWorkspace(params);

  if (!controller.isReady) {
    return (
      <main className="p-8">
        <p>{controller.loadingMessage}</p>
        {controller.actionError && <p className="mt-2 text-sm text-red-700">{controller.actionError}</p>}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1600px] p-6">
      <ProjectNav id={controller.projectId} />
      <h1 className="font-heading text-3xl">第 {controller.chapterNo} 章工作台</h1>
      <div className="mt-4 grid grid-cols-12 gap-4">
        <ContextPanel controller={controller} />
        <EditorPanel controller={controller} />
        <DiagnosticsPanel controller={controller} />
        <AuthorAdvisorPanel controller={controller} />
      </div>
    </main>
  );
}
