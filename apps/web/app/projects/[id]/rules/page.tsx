"use client";

import { useEffect, useMemo, useState } from "react";
import { ProjectNav } from "@/components/project-nav";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  createProjectResource,
  deleteProjectResource,
  fetchProjectCollection,
  updateProjectResource,
} from "@/lib/story-resources";

type Props = { params: Promise<{ id: string }> };
type RuleTab = "sensitive" | "regex";

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function countTextHits(text: string, needle: string) {
  if (!text.trim() || !needle.trim()) return 0;
  let count = 0;
  let from = 0;
  while (from < text.length) {
    const index = text.indexOf(needle, from);
    if (index < 0) break;
    count += 1;
    from = index + needle.length;
  }
  return count;
}

function previewRegex(text: string, pattern: string, flags?: string) {
  if (!text.trim() || !pattern.trim()) return { hits: 0, error: "" };
  try {
    const regex = new RegExp(pattern, flags ?? "");
    const matches = text.match(regex) ?? [];
    return { hits: matches.length, error: "" };
  } catch (error) {
    return { hits: 0, error: error instanceof Error ? error.message : "Regex 无效" };
  }
}

export default function RulesPage({ params }: Props) {
  const [projectId, setProjectId] = useState("");
  const [tab, setTab] = useState<RuleTab>("sensitive");
  const [sensitiveWords, setSensitiveWords] = useState<any[]>([]);
  const [regexRules, setRegexRules] = useState<any[]>([]);
  const [previewText, setPreviewText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sensitiveDraft, setSensitiveDraft] = useState({
    term: "",
    replacement: "",
    severity: "med",
    notes: "",
    enabled: true,
  });
  const [regexDraft, setRegexDraft] = useState({
    name: "",
    pattern: "",
    flags: "g",
    severity: "med",
    description: "",
    enabled: true,
  });

  async function loadRules(id: string) {
    setLoading(true);
    setError("");
    try {
      const [sensitiveData, regexData] = await Promise.all([
        fetchProjectCollection<any[]>(id, "rules/sensitive-words", { include: "stats,references" }),
        fetchProjectCollection<any[]>(id, "rules/regex", { include: "stats,references" }),
      ]);
      setSensitiveWords(asArray(sensitiveData));
      setRegexRules(asArray(regexData));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "规则加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      const { id } = await params;
      setProjectId(id);
      await loadRules(id);
    })();
  }, [params]);

  const summary = useMemo(
    () => ({
      sensitive: sensitiveWords.length,
      regex: regexRules.length,
      activeSensitive: sensitiveWords.filter((item) => item.enabled).length,
      activeRegex: regexRules.filter((item) => item.enabled).length,
    }),
    [regexRules, sensitiveWords],
  );

  function patchSensitive(id: string, patch: Record<string, unknown>) {
    setSensitiveWords((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function patchRegex(id: string, patch: Record<string, unknown>) {
    setRegexRules((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function createSensitiveWord() {
    if (!sensitiveDraft.term.trim()) {
      setError("敏感词不能为空");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createProjectResource(projectId, "rules/sensitive-words", sensitiveDraft);
      setSensitiveDraft({ term: "", replacement: "", severity: "med", notes: "", enabled: true });
      setMessage("敏感词规则已创建");
      await loadRules(projectId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "创建敏感词失败");
    } finally {
      setSaving(false);
    }
  }

  async function createRegexRule() {
    if (!regexDraft.name.trim() || !regexDraft.pattern.trim()) {
      setError("规则名和 pattern 不能为空");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createProjectResource(projectId, "rules/regex", regexDraft);
      setRegexDraft({ name: "", pattern: "", flags: "g", severity: "med", description: "", enabled: true });
      setMessage("Regex 规则已创建");
      await loadRules(projectId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "创建 Regex 规则失败");
    } finally {
      setSaving(false);
    }
  }

  async function saveSensitiveWord(item: any) {
    setSaving(true);
    setError("");
    try {
      await updateProjectResource(projectId, "rules/sensitive-words", item.id, {
        term: item.term,
        replacement: item.replacement,
        severity: item.severity,
        notes: item.notes,
        enabled: item.enabled,
      });
      setMessage(`已保存敏感词 ${item.term}`);
      await loadRules(projectId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "更新敏感词失败");
    } finally {
      setSaving(false);
    }
  }

  async function saveRegexRule(item: any) {
    setSaving(true);
    setError("");
    try {
      await updateProjectResource(projectId, "rules/regex", item.id, {
        name: item.name,
        pattern: item.pattern,
        flags: item.flags,
        severity: item.severity,
        description: item.description,
        enabled: item.enabled,
      });
      setMessage(`已保存规则 ${item.name}`);
      await loadRules(projectId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "更新 Regex 规则失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeRule(collection: string, id: string, successMessage: string) {
    setSaving(true);
    setError("");
    try {
      await deleteProjectResource(projectId, collection, id);
      setMessage(successMessage);
      await loadRules(projectId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "删除规则失败");
    } finally {
      setSaving(false);
    }
  }

  if (!projectId) {
    return <main className="p-8">加载中...</main>;
  }

  return (
    <main className="mx-auto max-w-7xl p-8">
      <ProjectNav id={projectId} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl">规则库</h1>
          <p className="mt-2 text-sm text-black/60">集中管理敏感词和 Regex 规则，并支持本地命中预览。</p>
        </div>
        <div className="grid gap-2 text-sm text-black/70">
          <div className="rounded-lg bg-black/[0.03] px-3 py-2">敏感词: {summary.sensitive} / 启用 {summary.activeSensitive}</div>
          <div className="rounded-lg bg-black/[0.03] px-3 py-2">Regex: {summary.regex} / 启用 {summary.activeRegex}</div>
        </div>
      </div>

      {(error || message) && (
        <div className={`mt-4 rounded-md px-3 py-2 text-sm ${error ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>
          {error || message}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Button variant={tab === "sensitive" ? "default" : "ghost"} onClick={() => setTab("sensitive")}>
          Sensitive Words
        </Button>
        <Button variant={tab === "regex" ? "default" : "ghost"} onClick={() => setTab("regex")}>
          Regex Rules
        </Button>
      </div>

      <Card className="mt-4">
        <h2 className="text-lg font-semibold">命中预览</h2>
        <textarea
          className="mt-3 min-h-28 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
          placeholder="把一段正文贴到这里，页面会立即预览命中哪些敏感词 / Regex 规则。"
          value={previewText}
          onChange={(e) => setPreviewText(e.target.value)}
        />
      </Card>

      {tab === "sensitive" ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]">
          <Card>
            <h2 className="text-lg font-semibold">新增敏感词</h2>
            <div className="mt-3 grid gap-3">
              <input
                className="rounded-md border border-black/15 px-3 py-2 text-sm"
                placeholder="敏感词"
                value={sensitiveDraft.term}
                onChange={(e) => setSensitiveDraft((current) => ({ ...current, term: e.target.value }))}
              />
              <input
                className="rounded-md border border-black/15 px-3 py-2 text-sm"
                placeholder="推荐替换"
                value={sensitiveDraft.replacement}
                onChange={(e) => setSensitiveDraft((current) => ({ ...current, replacement: e.target.value }))}
              />
              <select
                className="rounded-md border border-black/15 px-3 py-2 text-sm"
                value={sensitiveDraft.severity}
                onChange={(e) => setSensitiveDraft((current) => ({ ...current, severity: e.target.value }))}
              >
                <option value="low">low</option>
                <option value="med">med</option>
                <option value="high">high</option>
              </select>
              <textarea
                className="min-h-24 rounded-md border border-black/15 px-3 py-2 text-sm"
                placeholder="备注"
                value={sensitiveDraft.notes}
                onChange={(e) => setSensitiveDraft((current) => ({ ...current, notes: e.target.value }))}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={sensitiveDraft.enabled}
                  onChange={(e) => setSensitiveDraft((current) => ({ ...current, enabled: e.target.checked }))}
                />
                启用
              </label>
              <Button variant="secondary" disabled={saving} onClick={() => void createSensitiveWord()}>
                {saving ? "处理中..." : "创建敏感词"}
              </Button>
            </div>
          </Card>

          <div className="grid gap-4">
            {loading && <Card>规则加载中...</Card>}
            {!loading && sensitiveWords.length === 0 && <Card>暂无敏感词规则。</Card>}
            {sensitiveWords.map((item) => {
              const previewHits = countTextHits(previewText, item.term ?? "");
              return (
                <Card key={item.id}>
                  <div className="grid gap-3 md:grid-cols-[1.1fr_1fr]">
                    <div className="grid gap-2">
                      <input
                        className="rounded-md border border-black/15 px-3 py-2 text-sm font-semibold"
                        value={item.term ?? ""}
                        onChange={(e) => patchSensitive(item.id, { term: e.target.value })}
                      />
                      <input
                        className="rounded-md border border-black/15 px-3 py-2 text-sm"
                        value={item.replacement ?? ""}
                        onChange={(e) => patchSensitive(item.id, { replacement: e.target.value })}
                      />
                      <select
                        className="rounded-md border border-black/15 px-3 py-2 text-sm"
                        value={item.severity ?? "med"}
                        onChange={(e) => patchSensitive(item.id, { severity: e.target.value })}
                      >
                        <option value="low">low</option>
                        <option value="med">med</option>
                        <option value="high">high</option>
                      </select>
                      <textarea
                        className="min-h-20 rounded-md border border-black/15 px-3 py-2 text-sm"
                        value={item.notes ?? ""}
                        onChange={(e) => patchSensitive(item.id, { notes: e.target.value })}
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(item.enabled)}
                          onChange={(e) => patchSensitive(item.id, { enabled: e.target.checked })}
                        />
                        启用
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" disabled={saving} onClick={() => void saveSensitiveWord(item)}>
                          保存
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={saving}
                          onClick={() => void removeRule("rules/sensitive-words", item.id, "敏感词规则已删除")}
                        >
                          删除
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3">
                      <div className="rounded-lg bg-black/[0.03] p-3 text-sm">
                        <p>引用章节数: {item.stats?.total_chapters ?? 0}</p>
                        <p>累计命中数: {item.stats?.total_hits ?? 0}</p>
                        <p>最近章节: {item.stats?.latest_chapter_no ?? "-"}</p>
                        <p>预览命中: {previewHits}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {asArray(item.references).slice(0, 6).map((reference: any) => (
                          <span key={reference.id} className="rounded-full bg-red-50 px-3 py-1 text-xs text-red-700">
                            第 {reference.chapter?.chapter_no ?? "-"} 章 · {reference.state}
                          </span>
                        ))}
                        {asArray(item.references).length === 0 && <span className="text-xs text-black/50">暂无引用</span>}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]">
          <Card>
            <h2 className="text-lg font-semibold">新增 Regex 规则</h2>
            <div className="mt-3 grid gap-3">
              <input
                className="rounded-md border border-black/15 px-3 py-2 text-sm"
                placeholder="规则名"
                value={regexDraft.name}
                onChange={(e) => setRegexDraft((current) => ({ ...current, name: e.target.value }))}
              />
              <input
                className="rounded-md border border-black/15 px-3 py-2 text-sm"
                placeholder="pattern"
                value={regexDraft.pattern}
                onChange={(e) => setRegexDraft((current) => ({ ...current, pattern: e.target.value }))}
              />
              <input
                className="rounded-md border border-black/15 px-3 py-2 text-sm"
                placeholder="flags"
                value={regexDraft.flags}
                onChange={(e) => setRegexDraft((current) => ({ ...current, flags: e.target.value }))}
              />
              <select
                className="rounded-md border border-black/15 px-3 py-2 text-sm"
                value={regexDraft.severity}
                onChange={(e) => setRegexDraft((current) => ({ ...current, severity: e.target.value }))}
              >
                <option value="low">low</option>
                <option value="med">med</option>
                <option value="high">high</option>
              </select>
              <textarea
                className="min-h-24 rounded-md border border-black/15 px-3 py-2 text-sm"
                placeholder="规则说明"
                value={regexDraft.description}
                onChange={(e) => setRegexDraft((current) => ({ ...current, description: e.target.value }))}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={regexDraft.enabled}
                  onChange={(e) => setRegexDraft((current) => ({ ...current, enabled: e.target.checked }))}
                />
                启用
              </label>
              <Button variant="secondary" disabled={saving} onClick={() => void createRegexRule()}>
                {saving ? "处理中..." : "创建 Regex 规则"}
              </Button>
            </div>
          </Card>

          <div className="grid gap-4">
            {loading && <Card>规则加载中...</Card>}
            {!loading && regexRules.length === 0 && <Card>暂无 Regex 规则。</Card>}
            {regexRules.map((item) => {
              const preview = previewRegex(previewText, item.pattern ?? "", item.flags ?? "");
              return (
                <Card key={item.id}>
                  <div className="grid gap-3 md:grid-cols-[1.1fr_1fr]">
                    <div className="grid gap-2">
                      <input
                        className="rounded-md border border-black/15 px-3 py-2 text-sm font-semibold"
                        value={item.name ?? ""}
                        onChange={(e) => patchRegex(item.id, { name: e.target.value })}
                      />
                      <input
                        className="rounded-md border border-black/15 px-3 py-2 font-mono text-sm"
                        value={item.pattern ?? ""}
                        onChange={(e) => patchRegex(item.id, { pattern: e.target.value })}
                      />
                      <input
                        className="rounded-md border border-black/15 px-3 py-2 text-sm"
                        value={item.flags ?? ""}
                        onChange={(e) => patchRegex(item.id, { flags: e.target.value })}
                      />
                      <select
                        className="rounded-md border border-black/15 px-3 py-2 text-sm"
                        value={item.severity ?? "med"}
                        onChange={(e) => patchRegex(item.id, { severity: e.target.value })}
                      >
                        <option value="low">low</option>
                        <option value="med">med</option>
                        <option value="high">high</option>
                      </select>
                      <textarea
                        className="min-h-20 rounded-md border border-black/15 px-3 py-2 text-sm"
                        value={item.description ?? ""}
                        onChange={(e) => patchRegex(item.id, { description: e.target.value })}
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(item.enabled)}
                          onChange={(e) => patchRegex(item.id, { enabled: e.target.checked })}
                        />
                        启用
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" disabled={saving} onClick={() => void saveRegexRule(item)}>
                          保存
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={saving}
                          onClick={() => void removeRule("rules/regex", item.id, "Regex 规则已删除")}
                        >
                          删除
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3">
                      <div className="rounded-lg bg-black/[0.03] p-3 text-sm">
                        <p>引用章节数: {item.stats?.total_chapters ?? 0}</p>
                        <p>累计命中数: {item.stats?.total_hits ?? 0}</p>
                        <p>最近章节: {item.stats?.latest_chapter_no ?? "-"}</p>
                        <p>预览命中: {preview.hits}</p>
                        {preview.error && <p className="mt-1 text-red-600">Regex 错误: {preview.error}</p>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {asArray(item.references).slice(0, 6).map((reference: any) => (
                          <span key={reference.id} className="rounded-full bg-purple-50 px-3 py-1 text-xs text-purple-700">
                            第 {reference.chapter?.chapter_no ?? "-"} 章 · {reference.state}
                          </span>
                        ))}
                        {asArray(item.references).length === 0 && <span className="text-xs text-black/50">暂无引用</span>}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
