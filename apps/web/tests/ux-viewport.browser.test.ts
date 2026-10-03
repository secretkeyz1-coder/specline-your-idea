import { expect, test } from "bun:test";
import { chromium } from "playwright";

test("artboards keep viewport CSS stable, allow long content and save original styles", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const source = await Bun.file(new URL("../src/lib/ux-canvas.ts", import.meta.url)).text();
    const script = new Bun.Transpiler({ loader: "ts" }).transformSync(source).replace(/^export /gm, "");
    await page.addScriptTag({ content: script });
    const result = await page.evaluate(async () => {
      const frame = document.createElement("iframe");
      frame.style.cssText = "width:1440px;height:900px";
      const loaded = new Promise<void>((resolve) => frame.onload = () => resolve());
      frame.srcdoc = `<style data-screen>
        *{box-sizing:border-box}body{margin:0}header{height:120px}
        main{padding:40px}.login{min-height:calc(100vh - 72px)}
        @media(min-width:600px){.card{min-height:50dvh}}
        .card::before{content:"100vh"}
      </style><div data-sdd-app><header></header><main data-screen-content>
        <section class="login"><div class="card" style="height:55svh!important">Login</div></section>
      </main></div>`;
      document.body.append(frame);
      await loaded;
      const doc = frame.contentDocument!;
      const originalCss = doc.querySelector("style")!.textContent;
      // Evaluate the same measurement steps as ArtboardNode against real layout.
      const measure = (preset: number) => {
        // @ts-expect-error helper is injected into the browser from the source above
        pinViewportHeight(doc, preset);
        frame.style.height = `${preset}px`;
        const height = Math.max(doc.body.scrollHeight, preset);
        frame.style.height = `${height}px`;
        return height;
      };
      const heights = Array.from({ length: 8 }, () => measure(900));
      // @ts-expect-error helper is injected into the browser
      const saved: string = contentForSave(doc, { od: true });
      const savedDoc = new DOMParser().parseFromString(saved, "text/html");
      const inline = (savedDoc.querySelector(".card") as HTMLElement).style;
      const mobile = measure(600);
      const content = doc.querySelector(".card") as HTMLElement;
      content.style.height = "17000px";
      const long = measure(900);
      // @ts-expect-error helper is injected into the browser
      const edited: string = contentForSave(doc, { od: true });
      content.style.height = "200px";
      const short = measure(900);
      return { heights, mobile, long, short, cssUnchanged: doc.querySelector("style")!.textContent === originalCss,
        inline: inline.height, priority: inline.getPropertyPriority("height"),
        savedOriginalCss: saved.includes(originalCss!), editedPreserved: edited.includes("17000px") };
    });
    expect(new Set(result.heights).size).toBe(1);
    expect(result.heights[0]).toBe(1028);
    expect(result.mobile).toBe(728);
    expect(result.long).toBeGreaterThan(17000);
    expect(result.short).toBe(1028);
    expect(result.cssUnchanged).toBe(true);
    expect(result.savedOriginalCss).toBe(true);
    expect(result.inline).toBe("55svh");
    expect(result.priority).toBe("important");
    expect(result.editedPreserved).toBe(true);
  } finally {
    await browser.close();
  }
}, 20000);
