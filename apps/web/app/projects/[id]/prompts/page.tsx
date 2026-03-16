"use client";

import { useEffect, useMemo, useState } from "react";
import { ProjectNav } from "@/components/project-nav";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { API_BASE } from "@/lib/api";

type Props = { params: Promise<{ id: string }> };

type PromptStage = "beats" | "draft" | "polish" | "fix" | "quality_eval" | "director" | "adaptation";

type PromptTemplateVersion = {
  id: string;
  prompt_version: number;
  stage: PromptStage;
  platform_variant: string;
  template?: string | null;
  system_template?: string | null;
  user_template?: string | null;
  input_contract?: Record<string, unknown> | null;
  output_contract?: Record<string, unknown> | null;
  is_active: boolean;
  created_at?: string;
};

type PromptTemplate = {
  id: string;
  project_id?: string | null;
  prompt_name: string;
  purpose: string;
  versions: PromptTemplateVersion[];
};

type ChapterItem = {
  id: string;
  chapter_no: number;
  title?: string | null;
};

type PreviewResult = {
  stage: PromptStage;
  prompt_name: string;
  prompt_version: string;
  prompt_template_version_id?: string | null;
  platform_variant: string;
  style_preset_name?: string | null;
  source: string;
  system: string;
  user: string;
  input_summary: Record<string, unknown> | string | null;
  context_hash: string;
};

type ExperimentResult = {
  experiment_id: string;
  chapter_id: string;
  type: string;
  winner: string | null;
  variant_a: {
    prompt_template_version_id?: string | null;
    quality_score?: number;
    manual_score?: number;
    version_id?: string;
  };
  variant_b: {
    prompt_template_version_id?: string | null;
    quality_score?: number;
    manual_score?: number;
    version_id?: string;
  };
};

const REQUEST_TIMEOUT_MS = 120_000;
const STAGES: Array<{ id: PromptStage; label: string; promptName: string; purpose: string }> = [
  { id: "beats", label: "Beats", promptName: "beats_prompt", purpose: "章节骨架生成" },
  { id: "draft", label: "Draft", promptName: "draft_prompt", purpose: "正文初稿生成" },
  { id: "polish", label: "Polish", promptName: "polish_prompt", purpose: "正文润色定稿" },
  { id: "fix", label: "Fix", promptName: "fix_prompt", purpose: "定向修复" },
  { id: "quality_eval", label: "Quality", promptName: "quality_eval_prompt", purpose: "质量评估" },
  { id: "director", label: "Director", promptName: "director_prompt", purpose: "总编审阅" },
  { id: "adaptation", label: "Adaptation", promptName: "adaptation_prompt", purpose: "改编输出" },
];

function formatErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function prettyJson(value: unknown) {
  if (!value || (typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0)) {
    return "{}";
  }
  return JSON.stringify(value, null, 2);
}

function parseJsonInput(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    throw new Error(`${label} 不是合法 JSON`);
  }
}

function parseOptionalScore(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error("人工分必须是 0-10 的数字");
  }
  return parsed;
}

export default function PromptStudioPage({ params }: Props) {
  const [projectId, setProjectId] = useState("");
  const [project, setProject] = useState<Record<string, any> | null>(null);
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [selectedStage, setSelectedStage] = useState<PromptStage>("draft");
  const [previewChapterId, setPreviewChapterId] = useState("");
  const [previewInstruction, setPreviewInstruction] = useState("");
  const [previewStylePresetName, setPreviewStylePresetName] = useState("");
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [experimentVariantA, setExperimentVariantA] = useState("");
  const [experimentVariantB, setExperimentVariantB] = useState("");
  const [manualScoreA, setManualScoreA] = useState("8");
  const [manualScoreB, setManualScoreB] = useState("7");
  const [experimentResult, setExperimentResult] = useState<ExperimentResult | null>(null);
  const [pageError, setPageError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [experimentLoading, setExperimentLoading] = useState(false);

  const [formStage, setFormStage] = useState<PromptStage>("draft");
  const [formPromptName, setFormPromptName] = useState("draft_prompt");
  const [formPurpose, setFormPurpose] = useState("正文初稿生成");
  const [formPromptVersion, setFormPromptVersion] = useState("1");
  const [formPlatformVariant, setFormPlatformVariant] = useState("default");
  const [formSystemTemplate, setFormSystemTemplate] = useState("");
  const [formUserTemplate, setFormUserTemplate] = useState("");
  const [formInputContract, setFormInputContract] = useState("{}");
  const [formOutputContract, setFormOutputContract] = useState("{}");

  async function requestJson<T = any>(url: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const method = (init?.method ?? "GET").toUpperCase();
      const res = await fetch(url, {
        ...init,
        cache: method === "GET" ? "no-store" : init?.cache,
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.message === "string" ? data.message : `请求失败: ${res.status}`);
      }
      return data as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`请求超时（>${Math.ceil(timeoutMs / 1000)}秒）`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadPage(id: string) {
    const [projectData, chapterData, promptData] = await Promise.all([
      requestJson<Record<string, any>>(`${API_BASE}/projects/${id}`),
      requestJson<ChapterItem[]>(`${API_BASE}/projects/${id}/chapters`),
      requestJson<PromptTemplate[]>(`${API_BASE}/prompt-templates?project_id=${id}`),
    ]);

    setProject(projectData);
    setChapters(Array.isArray(chapterData) ? chapterData : []);
    setTemplates(Array.isArray(promptData) ? promptData : []);
    setPreviewChapterId((current) => current || chapterData?.[0]?.id || "");
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { id } = await params;
        if (cancelled) return;
        setProjectId(id);
        await loadPage(id);
      } catch (error) {
        if (!cancelled) {
          setPageError(formatErrorMessage(error, "Prompt Studio 加载失败"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  useEffect(() => {
    const stageMeta = STAGES.find((item) => item.id === formStage);
    if (!stageMeta) return;
    setFormPromptName(stageMeta.promptName);
    setFormPurpose(stageMeta.purpose);
  }, [formStage]);

  const stageTemplates = useMemo(
    () =>
      templates
        .filter((template) => template.versions.some((version) => version.stage === selectedStage))
        .sort((left, right) => Number(Boolean(right.project_id)) - Number(Boolean(left.project_id))),
    [selectedStage, templates],
  );

  const experimentOptions = useMemo(
    () =>
      stageTemplates.flatMap((template) =>
        template.versions
          .filter((version) => version.stage === selectedStage)
          .map((version) => ({
            id: version.id,
            prompt_name: template.prompt_name,
            prompt_version: version.prompt_version,
            platform_variant: version.platform_variant,
            label: `${template.project_id ? "项目" : "系统"} · ${template.prompt_name} · v${version.prompt_version}/${version.platform_variant}`,
          })),
      ),
    [selectedStage, stageTemplates],
  );

  useEffect(() => {
    const nextVersion =
      templates
        .filter((template) => template.project_id)
        .flatMap((template) => template.versions)
        .filter((version) => version.stage === formStage && version.platform_variant === formPlatformVariant)
        .reduce((max, version) => Math.max(max, version.prompt_version), 0) + 1;
    setFormPromptVersion(String(nextVersion || 1));
  }, [formPlatformVariant, formStage, templates]);

  useEffect(() => {
    const [first, second] = experimentOptions;
    setExperimentVariantA((current) =>
      experimentOptions.some((option) => option.id === current) ? current : first?.id || "",
    );
    setExperimentVariantB((current) =>
      experimentOptions.some((option) => option.id === current) ? current : second?.id || first?.id || "",
    );
  }, [experimentOptions]);

  async function runPreview(payload: {
    stage: PromptStage;
    prompt_template_version_id?: string;
    platform_variant?: string;
  }) {
    if (!previewChapterId) {
      setPageError("请先选择用于预览的章节");
      return;
    }
    setPageError("");
    setPreviewLoading(true);
    try {
      const result = await requestJson<PreviewResult>(`${API_BASE}/prompt-templates/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapter_id: previewChapterId,
          stage: payload.stage,
          prompt_template_version_id: payload.prompt_template_version_id,
          platform_variant: payload.platform_variant,
          style_preset_name: previewStylePresetName.trim() || undefined,
          instruction: previewInstruction.trim() || undefined,
        }),
      });
      setPreviewResult(result);
      setActionMessage(`已预览 ${result.prompt_name}/${result.prompt_version}`);
    } catch (error) {
      setPageError(formatErrorMessage(error, "预览 prompt 失败"));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function createPromptTemplate() {
    if (!projectId) return;
    setPageError("");
    setActionLoading(true);
    try {
      const promptVersion = Number.parseInt(formPromptVersion, 10);
      if (!Number.isFinite(promptVersion) || promptVersion < 1) {
        throw new Error("Prompt 版本号必须大于 0");
      }

      await requestJson(`${API_BASE}/prompt-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          prompt_name: formPromptName.trim(),
          stage: formStage,
          purpose: formPurpose.trim(),
          versions: [
            {
              prompt_version: promptVersion,
              platform_variant: formPlatformVariant.trim() || "default",
              system_template: formSystemTemplate,
              user_template: formUserTemplate,
              input_contract: parseJsonInput(formInputContract, "Input Contract"),
              output_contract: parseJsonInput(formOutputContract, "Output Contract"),
              is_active: true,
            },
          ],
        }),
      });

      await loadPage(projectId);
      setActionMessage(`已保存 ${formPromptName} v${promptVersion}/${formPlatformVariant}`);
    } catch (error) {
      setPageError(formatErrorMessage(error, "保存 Prompt 模板失败"));
    } finally {
      setActionLoading(false);
    }
  }

  async function rollbackPromptTemplate(promptTemplateId: string, promptVersion: number) {
    setPageError("");
    setActionLoading(true);
    try {
      await requestJson(`${API_BASE}/prompt-templates/${promptTemplateId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt_version: promptVersion }),
      });
      await loadPage(projectId);
      setActionMessage(`已激活 v${promptVersion} 的所有平台变体`);
    } catch (error) {
      setPageError(formatErrorMessage(error, "回滚 Prompt 版本失败"));
    } finally {
      setActionLoading(false);
    }
  }

  function cloneToForm(template: PromptTemplate, version: PromptTemplateVersion) {
    setFormStage(version.stage);
    setFormPromptName(template.prompt_name);
    setFormPurpose(template.purpose);
    setFormPlatformVariant(version.platform_variant || "default");
    setFormPromptVersion(String(version.prompt_version + 1));
    setFormSystemTemplate(version.system_template ?? "");
    setFormUserTemplate(version.user_template ?? version.template ?? "");
    setFormInputContract(prettyJson(version.input_contract));
    setFormOutputContract(prettyJson(version.output_contract));
  }

  async function runPromptExperiment() {
    if (!previewChapterId) {
      setPageError("请先选择实验章节");
      return;
    }
    if (!experimentVariantA || !experimentVariantB) {
      setPageError("请先选择 A/B 两个模板版本");
      return;
    }
    if (experimentVariantA === experimentVariantB) {
      setPageError("A/B 实验必须选择两个不同的模板版本");
      return;
    }

    const variantA = experimentOptions.find((item) => item.id === experimentVariantA);
    const variantB = experimentOptions.find((item) => item.id === experimentVariantB);
    if (!variantA || !variantB) {
      setPageError("所选实验版本不存在，请刷新后重试");
      return;
    }

    setPageError("");
    setExperimentLoading(true);
    try {
      const result = await requestJson<ExperimentResult>(`${API_BASE}/chapters/${previewChapterId}/experiment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "prompt_ab",
          variant_a: {
            label: "A",
            prompt_template_version_id: variantA.id,
            prompt_name: variantA.prompt_name,
            prompt_version_number: variantA.prompt_version,
            platform_variant: variantA.platform_variant,
            manual_score: parseOptionalScore(manualScoreA),
          },
          variant_b: {
            label: "B",
            prompt_template_version_id: variantB.id,
            prompt_name: variantB.prompt_name,
            prompt_version_number: variantB.prompt_version,
            platform_variant: variantB.platform_variant,
            manual_score: parseOptionalScore(manualScoreB),
          },
        }),
      });
      setExperimentResult(result);
      setActionMessage(`Prompt A/B 已完成，winner: ${result.winner ?? "draw"}`);
    } catch (error) {
      setPageError(formatErrorMessage(error, "Prompt A/B 实验失败"));
    } finally {
      setExperimentLoading(false);
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
          <h1 className="font-heading text-3xl">{project?.title ?? "项目"} Prompt Studio</h1>
          <p className="mt-2 text-sm text-black/65">统一查看当前模板、创建项目级覆盖，并对真实章节做 render preview。</p>
        </div>
        {actionMessage ? <p className="text-sm text-emerald-700">{actionMessage}</p> : null}
      </div>

      {pageError ? <div className="mt-4 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{pageError}</div> : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap gap-2">
              {STAGES.map((stage) => (
                <Button
                  key={stage.id}
                  variant={selectedStage === stage.id ? "default" : "ghost"}
                  className="h-8 px-3"
                  onClick={() => setSelectedStage(stage.id)}
                >
                  {stage.label}
                </Button>
              ))}
            </div>
          </Card>

          {stageTemplates.length === 0 ? (
            <Card>
              <p className="text-sm text-black/60">当前 stage 还没有模板。</p>
            </Card>
          ) : (
            stageTemplates.map((template) => (
              <Card key={template.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-black/45">
                      {template.project_id ? "项目覆盖" : "系统默认"}
                    </p>
                    <h2 className="text-lg font-semibold">{template.prompt_name}</h2>
                    <p className="mt-1 text-sm text-black/65">{template.purpose}</p>
                  </div>
                  <span className="rounded-full bg-black/5 px-3 py-1 text-xs text-black/65">
                    {template.versions.filter((version) => version.is_active).length} active
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {template.versions
                    .filter((version) => version.stage === selectedStage)
                    .sort((left, right) =>
                      left.prompt_version === right.prompt_version
                        ? left.platform_variant.localeCompare(right.platform_variant)
                        : right.prompt_version - left.prompt_version,
                    )
                    .map((version) => (
                      <div key={version.id} className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">
                              v{version.prompt_version} / {version.platform_variant}
                            </p>
                            <p className="text-[11px] text-black/60">
                              {version.is_active ? "当前激活" : "非激活"} · {version.created_at ? new Date(version.created_at).toLocaleString() : "未记录时间"}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="ghost"
                              className="h-8 px-3"
                              disabled={previewLoading}
                              onClick={() =>
                                runPreview({
                                  stage: version.stage,
                                  prompt_template_version_id: version.id,
                                  platform_variant: version.platform_variant,
                                })
                              }
                            >
                              {previewLoading ? "预览中..." : "Render Preview"}
                            </Button>
                            {template.project_id ? (
                              <Button
                                variant="ghost"
                                className="h-8 px-3"
                                disabled={actionLoading}
                                onClick={() => rollbackPromptTemplate(template.id, version.prompt_version)}
                              >
                                激活此版本
                              </Button>
                            ) : null}
                            <Button variant="ghost" className="h-8 px-3" onClick={() => cloneToForm(template, version)}>
                              复制到表单
                            </Button>
                          </div>
                        </div>

                        <details className="mt-3 rounded-lg border border-black/10 bg-white/70 px-3 py-2 text-xs">
                          <summary className="cursor-pointer text-black/65">查看模板与 Contract</summary>
                          <div className="mt-3 space-y-3">
                            <div>
                              <p className="font-medium">System Template</p>
                              <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-black/[0.03] p-2 text-[11px]">{version.system_template ?? "-"}</pre>
                            </div>
                            <div>
                              <p className="font-medium">User Template</p>
                              <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-black/[0.03] p-2 text-[11px]">{version.user_template ?? version.template ?? "-"}</pre>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                              <div>
                                <p className="font-medium">Input Contract</p>
                                <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-black/[0.03] p-2 text-[11px]">{prettyJson(version.input_contract)}</pre>
                              </div>
                              <div>
                                <p className="font-medium">Output Contract</p>
                                <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-black/[0.03] p-2 text-[11px]">{prettyJson(version.output_contract)}</pre>
                              </div>
                            </div>
                          </div>
                        </details>
                      </div>
                    ))}
                </div>
              </Card>
            ))
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="text-lg font-semibold">Render Preview</h2>
            <p className="mt-1 text-sm text-black/65">只渲染 prompt，不触发生成，也不会落库。</p>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-sm">
                <span>章节</span>
                <select
                  className="rounded-md border border-black/15 bg-white px-3 py-2"
                  value={previewChapterId}
                  onChange={(event) => setPreviewChapterId(event.target.value)}
                >
                  {chapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>
                      第{chapter.chapter_no}章 {chapter.title ?? ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span>Style Preset Override</span>
                <input
                  className="rounded-md border border-black/15 bg-white px-3 py-2"
                  value={previewStylePresetName}
                  onChange={(event) => setPreviewStylePresetName(event.target.value)}
                  placeholder="留空则按项目当前策略"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span>附加指令</span>
                <textarea
                  className="min-h-24 rounded-md border border-black/15 bg-white px-3 py-2"
                  value={previewInstruction}
                  onChange={(event) => setPreviewInstruction(event.target.value)}
                  placeholder="可选，用来观察 instruction 如何进入 prompt"
                />
              </label>
              <Button disabled={previewLoading || !previewChapterId} onClick={() => runPreview({ stage: selectedStage, platform_variant: "default" })}>
                {previewLoading ? "预览中..." : `预览 ${STAGES.find((stage) => stage.id === selectedStage)?.label ?? selectedStage}`}
              </Button>
            </div>

            {previewResult ? (
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-lg border border-black/10 bg-black/[0.02] p-3">
                  <p className="font-medium">
                    {previewResult.prompt_name}/{previewResult.prompt_version}
                  </p>
                  <p className="mt-1 text-[12px] text-black/60">
                    {previewResult.platform_variant} · style {previewResult.style_preset_name ?? "-"} · {previewResult.source}
                  </p>
                  <p className="text-[12px] text-black/60">context hash: {previewResult.context_hash}</p>
                </div>
                <div>
                  <p className="font-medium">System</p>
                  <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-black/[0.03] p-3 text-[11px]">{previewResult.system}</pre>
                </div>
                <div>
                  <p className="font-medium">User</p>
                  <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-black/[0.03] p-3 text-[11px]">{previewResult.user}</pre>
                </div>
                <div>
                  <p className="font-medium">Input Summary</p>
                  <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-black/[0.03] p-3 text-[11px]">{prettyJson(previewResult.input_summary)}</pre>
                </div>
              </div>
            ) : null}
          </Card>

          <Card>
            <h2 className="text-lg font-semibold">Create Project Override</h2>
            <p className="mt-1 text-sm text-black/65">项目级模板优先于系统默认。建议先复制系统版本，再做针对项目的收口。</p>
            <div className="mt-4 grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span>Stage</span>
                  <select
                    className="rounded-md border border-black/15 bg-white px-3 py-2"
                    value={formStage}
                    onChange={(event) => setFormStage(event.target.value as PromptStage)}
                  >
                    {STAGES.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span>平台变体</span>
                  <input
                    className="rounded-md border border-black/15 bg-white px-3 py-2"
                    value={formPlatformVariant}
                    onChange={(event) => setFormPlatformVariant(event.target.value)}
                    placeholder="default / webnovel / toutiao-fiction / short-drama"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span>Prompt Name</span>
                  <input
                    className="rounded-md border border-black/15 bg-white px-3 py-2"
                    value={formPromptName}
                    onChange={(event) => setFormPromptName(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>Prompt Version</span>
                  <input
                    className="rounded-md border border-black/15 bg-white px-3 py-2"
                    value={formPromptVersion}
                    onChange={(event) => setFormPromptVersion(event.target.value)}
                  />
                </label>
              </div>

              <label className="grid gap-1 text-sm">
                <span>Purpose</span>
                <input
                  className="rounded-md border border-black/15 bg-white px-3 py-2"
                  value={formPurpose}
                  onChange={(event) => setFormPurpose(event.target.value)}
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span>System Template</span>
                <textarea
                  className="min-h-32 rounded-md border border-black/15 bg-white px-3 py-2"
                  value={formSystemTemplate}
                  onChange={(event) => setFormSystemTemplate(event.target.value)}
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span>User Template</span>
                <textarea
                  className="min-h-40 rounded-md border border-black/15 bg-white px-3 py-2"
                  value={formUserTemplate}
                  onChange={(event) => setFormUserTemplate(event.target.value)}
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span>Input Contract</span>
                  <textarea
                    className="min-h-28 rounded-md border border-black/15 bg-white px-3 py-2 font-mono text-xs"
                    value={formInputContract}
                    onChange={(event) => setFormInputContract(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>Output Contract</span>
                  <textarea
                    className="min-h-28 rounded-md border border-black/15 bg-white px-3 py-2 font-mono text-xs"
                    value={formOutputContract}
                    onChange={(event) => setFormOutputContract(event.target.value)}
                  />
                </label>
              </div>

              <Button disabled={actionLoading} onClick={createPromptTemplate}>
                {actionLoading ? "保存中..." : "保存项目级 Prompt"}
              </Button>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold">Prompt A/B</h2>
            <p className="mt-1 text-sm text-black/65">使用当前章节直接对比两个 prompt 版本。winner 优先看人工分，质量分兜底。</p>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-sm">
                <span>Variant A</span>
                <select
                  className="rounded-md border border-black/15 bg-white px-3 py-2"
                  value={experimentVariantA}
                  onChange={(event) => setExperimentVariantA(event.target.value)}
                >
                  {experimentOptions.map((option) => (
                    <option key={`a-${option.id}`} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span>Variant B</span>
                <select
                  className="rounded-md border border-black/15 bg-white px-3 py-2"
                  value={experimentVariantB}
                  onChange={(event) => setExperimentVariantB(event.target.value)}
                >
                  {experimentOptions.map((option) => (
                    <option key={`b-${option.id}`} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span>人工分 A</span>
                  <input
                    className="rounded-md border border-black/15 bg-white px-3 py-2"
                    value={manualScoreA}
                    onChange={(event) => setManualScoreA(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>人工分 B</span>
                  <input
                    className="rounded-md border border-black/15 bg-white px-3 py-2"
                    value={manualScoreB}
                    onChange={(event) => setManualScoreB(event.target.value)}
                  />
                </label>
              </div>
              <Button disabled={experimentLoading || experimentOptions.length < 2} onClick={runPromptExperiment}>
                {experimentLoading ? "实验中..." : "运行 Prompt A/B"}
              </Button>
            </div>

            {experimentResult ? (
              <div className="mt-4 rounded-lg border border-black/10 bg-black/[0.02] p-3 text-sm">
                <p className="font-medium">winner: {experimentResult.winner ?? "draw"}</p>
                <p className="mt-1 text-[12px] text-black/65">
                  A: q={experimentResult.variant_a.quality_score ?? "-"} / manual={experimentResult.variant_a.manual_score ?? "-"}
                </p>
                <p className="text-[12px] text-black/65">
                  B: q={experimentResult.variant_b.quality_score ?? "-"} / manual={experimentResult.variant_b.manual_score ?? "-"}
                </p>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </main>
  );
}
