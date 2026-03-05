"use client";

import dynamic from "next/dynamic";

const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type Props = {
  value: string;
  onChange?: (value: string) => void;
  language?: string;
  onMount?: (editor: any, monaco: any) => void;
};

export function MonacoEditor({ value, onChange, language = "markdown", onMount }: Props) {
  return (
    <Monaco
      height="620px"
      defaultLanguage={language}
      value={value}
      onMount={onMount}
      onChange={(val) => onChange?.(val ?? "")}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: "on",
        wordWrap: "on",
      }}
    />
  );
}
