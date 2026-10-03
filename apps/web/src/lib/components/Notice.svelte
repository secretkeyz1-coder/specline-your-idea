<script lang="ts">
  import type { Snippet } from "svelte";
  import { CircleCheck, CircleAlert, TriangleAlert, Info } from "lucide-svelte";

  /**
   * The one inline notice. Success and info are polite status messages,
   * warnings too; errors are alerts. Same size, padding and icon everywhere —
   * the app had 37 hand-built variants of this banner.
   */
  let {
    tone = "info",
    children,
    class: className = "",
  }: { tone?: "success" | "error" | "warn" | "info"; children: Snippet; class?: string } = $props();

  const TONE = {
    success: { cls: "border-mint/40 bg-mint-soft", icon: CircleCheck, ink: "text-mint", role: "status" },
    error: { cls: "border-danger/40 bg-danger-soft", icon: CircleAlert, ink: "text-danger", role: "alert" },
    warn: { cls: "border-warn/40 bg-warn-soft", icon: TriangleAlert, ink: "text-warn", role: "status" },
    info: { cls: "border-sky/40 bg-sky-soft", icon: Info, ink: "text-sky", role: "status" },
  } as const;
  const t = $derived(TONE[tone]);
</script>

<!-- daisyUI alert for shape and layout: a soft tint, a hairline in the tone,
     the icon carries the colour and the text stays base-content (AA on every tint). -->
<div class="alert flex items-start gap-2 rounded-box border px-3.5 py-2.5 text-[13px] leading-relaxed text-base-content shadow-none {t.cls} {className}" role={t.role}>
  <t.icon class="mt-[3px] size-4 shrink-0 {t.ink}" aria-hidden="true" />
  <div class="min-w-0 flex-1">{@render children()}</div>
</div>
