import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { ArrowLeft, Plus, Trash2, Pencil, BookOpen } from "lucide-react";
import { listSkills, getSkill, saveSkill, deleteSkill, type SkillInfo, type SkillDetail } from "../lib/agent";
import { useI18n } from "../lib/i18n";
import { motion } from "framer-motion";

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
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col bg-sidebar border-l border-border/40 font-sans">
        <SheetHeader className="border-b border-border/40 px-6 py-4 bg-background/50 backdrop-blur-xl flex-shrink-0">
          <div className="flex items-center gap-4">
            {view !== "list" && (
              <button onClick={() => setView("list")} className="text-muted-foreground/50 hover:text-foreground transition-all active:scale-90">
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <SheetTitle className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.3em]">
              {view === "list" && t("Skills")}
              {view === "view" && current?.name}
              {view === "edit" && (isNew ? t("New Skill") : t("Edit Skill"))}
            </SheetTitle>
            <div className="flex-1" />
            {view === "list" && (
              <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-xl transition-all active:scale-90" onClick={() => handleEdit()}>
                <Plus className="h-5 w-5" />
              </Button>
            )}
            {view === "view" && current && (
              <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-xl transition-all active:scale-90" onClick={() => handleEdit(current)}>
                <Pencil className="h-4 w-4" />
              </Button>
            )}
          </div>
        </SheetHeader>

        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-6 py-3 text-[11px] font-bold text-destructive bg-destructive/5 border-b border-destructive/10 uppercase tracking-wider text-center"
          >
            {error}
          </motion.div>
        )}

        <ScrollArea className="flex-1 min-h-0">
          {view === "list" && (
            <div className="p-6 space-y-3">
              {skills.length === 0 ? (
                <div className="text-center py-20 px-8">
                  <div className="w-20 h-20 rounded-[2rem] bg-muted/30 flex items-center justify-center mx-auto mb-6 border-2 border-dashed border-border/40">
                    <BookOpen className="h-10 w-10 text-muted-foreground/20" />
                  </div>
                  <p className="text-[15px] font-bold text-foreground mb-2">{t("No skills yet")}</p>
                  <p className="text-[12px] text-muted-foreground/60 leading-relaxed max-w-[240px] mx-auto">{t("Skills are reusable instructions that help me handle complex tasks.")}</p>
                </div>
              ) : (
                skills.map((s, i) => (
                  <motion.div
                    key={s.name}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="group relative flex items-start gap-4 p-5 rounded-2xl bg-card/50 border border-border/40 hover:border-primary/20 cursor-pointer transition-all hover:shadow-soft active:scale-[0.98]"
                    onClick={() => handleView(s.name)}
                  >
                    <div className="w-10 h-10 rounded-xl bg-primary/5 flex items-center justify-center text-primary group-hover:bg-primary/10 transition-colors shrink-0">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-bold text-foreground tracking-tight truncate">{s.name}</div>
                      <div className="text-[12px] text-muted-foreground/60 mt-1 line-clamp-2 leading-relaxed">{s.description}</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(s.name); }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground/30 hover:text-destructive transition-all active:scale-90 p-2"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </motion.div>
                ))
              )}
            </div>
          )}

          {view === "view" && current && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-8 space-y-8"
            >
              <div className="space-y-4">
                <div className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-[0.2em]">Description</div>
                <p className="text-[15px] font-medium text-foreground leading-relaxed">{current.description}</p>
              </div>
              <div className="space-y-4">
                <div className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-[0.2em]">Instruction Set</div>
                <div className="prose text-[14px] leading-relaxed whitespace-pre-wrap font-mono bg-card p-6 rounded-2xl border border-border/40 shadow-inner selection:bg-primary/20">
                  {current.content}
                </div>
              </div>
            </motion.div>
          )}

          {view === "edit" && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-8 space-y-10"
            >
              <div className="space-y-4">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-1">Symbolic Name</label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="deploy-api"
                  className="font-mono text-[14px] h-12 rounded-xl bg-card border-border/40 focus-visible:ring-primary/20 font-bold"
                  disabled={!isNew}
                />
              </div>
              <div className="space-y-4">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-1">Brief Description</label>
                <Input
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="One sentence to describe purpose and triggers"
                  className="text-[14px] h-12 rounded-xl bg-card border-border/40 focus-visible:ring-primary/20 font-medium"
                />
              </div>
              <div className="space-y-4">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-1">Implementation Logic</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="Describe the skill instructions in Markdown..."
                  className="w-full min-h-[400px] rounded-2xl border border-border/40 bg-card px-4 py-4 text-[14px] font-mono leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all shadow-inner"
                />
              </div>
              <Button onClick={handleSave} disabled={!editName.trim() || !editDesc.trim()} className="w-full h-14 text-[15px] font-bold rounded-2xl shadow-glow active:scale-[0.98] transition-all">
                {isNew ? t("Initialize Skill") : t("Save Changes")}
              </Button>
            </motion.div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
