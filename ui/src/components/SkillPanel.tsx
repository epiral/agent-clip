import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { ArrowLeft, Plus, Trash2, Pencil, BookOpen } from "lucide-react";
import { listSkills, getSkill, saveSkill, deleteSkill, type SkillInfo, type SkillDetail } from "../lib/agent";
import { useI18n } from "../lib/i18n";

interface SkillPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type View = "list" | "view" | "edit";

export function SkillPanel({ open, onOpenChange }: SkillPanelProps) {
  const { t } = useI18n();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [view, setView] = useState<View>("list");
  const [current, setCurrent] = useState<SkillDetail | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editContent, setEditContent] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const list = await listSkills();
      setSkills(list);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (open) {
      load();
      setView("list");
      setCurrent(null);
      setError(null);
    }
  }, [open]);

  const handleView = async (name: string) => {
    try {
      const detail = await getSkill(name);
      setCurrent(detail);
      setView("view");
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleEdit = (skill?: SkillDetail) => {
    if (skill) {
      setEditName(skill.name);
      setEditDesc(skill.description);
      setEditContent(skill.content);
      setIsNew(false);
    } else {
      setEditName("");
      setEditDesc("");
      setEditContent("");
      setIsNew(true);
    }
    setView("edit");
  };

  const handleSave = async () => {
    if (!editName.trim() || !editDesc.trim()) return;
    try {
      await saveSkill({ name: editName.trim(), description: editDesc.trim(), content: editContent });
      await load();
      setView("list");
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await deleteSkill(name);
      await load();
      if (current?.name === name) {
        setCurrent(null);
        setView("list");
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col glass-sidebar border-l border-border/40">
        <SheetHeader className="border-b border-border/40 px-5 py-3 bg-bg-surface/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            {view !== "list" && (
              <button onClick={() => setView("list")} className="text-text-mute hover:text-text-main transition-colors">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <SheetTitle className="text-sm font-semibold tracking-wide">
              {view === "list" && t("Skills")}
              {view === "view" && current?.name}
              {view === "edit" && (isNew ? t("New Skill") : t("Edit Skill"))}
            </SheetTitle>
            <div className="flex-1" />
            {view === "list" && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-text-mute hover:text-text-main" onClick={() => handleEdit()}>
                <Plus className="h-4 w-4" />
              </Button>
            )}
            {view === "view" && current && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-text-mute hover:text-text-main" onClick={() => handleEdit(current)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </SheetHeader>

        {error && (
          <div className="px-5 py-2 text-[11px] text-destructive bg-destructive/5 border-b border-destructive/10">
            {error}
          </div>
        )}

        <ScrollArea className="flex-1 min-h-0">
          {view === "list" && (
            <div className="p-3 space-y-1">
              {skills.length === 0 ? (
                <div className="text-center py-12 text-text-mute">
                  <BookOpen className="h-8 w-8 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">{t("No skills yet")}</p>
                  <p className="text-[11px] mt-1 opacity-60">{t("Skills are reusable instructions")}</p>
                </div>
              ) : (
                skills.map((s) => (
                  <div
                    key={s.name}
                    className="group flex items-start gap-3 p-3 rounded-lg hover:bg-bg-surface/60 cursor-pointer transition-colors"
                    onClick={() => handleView(s.name)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-text-main font-mono">{s.name}</div>
                      <div className="text-[11px] text-text-mute mt-0.5 line-clamp-2">{s.description}</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(s.name); }}
                      className="opacity-0 group-hover:opacity-100 text-text-mute hover:text-destructive transition-all mt-0.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {view === "view" && current && (
            <div className="p-5">
              <p className="text-[12px] text-text-mute mb-4 leading-relaxed">{current.description}</p>
              <div className="prose-custom text-[13px] leading-relaxed whitespace-pre-wrap font-mono bg-bg-surface/40 rounded-lg p-4 border border-border/30">
                {current.content}
              </div>
            </div>
          )}

          {view === "edit" && (
            <div className="p-5 space-y-4">
              <div>
                <label className="text-[11px] text-text-mute font-medium uppercase tracking-wider mb-1.5 block">Name</label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="deploy-api"
                  className="font-mono text-[13px] h-9"
                  disabled={!isNew}
                />
              </div>
              <div>
                <label className="text-[11px] text-text-mute font-medium uppercase tracking-wider mb-1.5 block">Description</label>
                <Input
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="一句话描述用途和触发场景"
                  className="text-[13px] h-9"
                />
              </div>
              <div>
                <label className="text-[11px] text-text-mute font-medium uppercase tracking-wider mb-1.5 block">Content</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="Skill 内容（Markdown）..."
                  className="w-full min-h-[300px] rounded-lg border border-border bg-bg-base px-3 py-2 text-[13px] font-mono leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-brand-primary/40"
                />
              </div>
              <Button onClick={handleSave} disabled={!editName.trim() || !editDesc.trim()} className="w-full h-9 text-[13px]">
                {isNew ? t("Create") : t("Save")}
              </Button>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
