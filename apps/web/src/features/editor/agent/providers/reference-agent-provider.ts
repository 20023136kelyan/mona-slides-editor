import type { AgentGeneratedPlan, AgentProvider } from '@/features/editor/agent/agent-types'

const referenceProgram = String.raw`
const slideId = context.currentSlideId;
const sketchElements = (context.sketch?.scene?.elements || []).filter(element => element.isDeleted !== true);
if (sketchElements.length) {
  for (const element of sketchElements) {
    const left = Number(element.x || 0);
    const top = Number(element.y || 0);
    const width = Math.max(8, Number(element.width || 8));
    const height = Math.max(8, Number(element.height || 8));
    if (element.type === "text" && element.text) {
      mona.elements.addText(slideId, {
        text: element.text,
        left, top, width: Math.max(width, 120), height: Math.max(height, 36),
        fontSize: Number(element.fontSize || 24),
        color: element.strokeColor || context.theme.fontColor,
        name: "Sketch text"
      });
    }
    else if (element.type === "rectangle" || element.type === "ellipse") {
      mona.elements.addShape(slideId, {
        shape: element.type === "ellipse" ? "ellipse" : "roundedRectangle",
        left, top, width, height,
        fill: element.backgroundColor === "transparent" ? "#f4f4f5" : (element.backgroundColor || "#f4f4f5"),
        stroke: element.strokeColor || "#71717a",
        strokeWidth: Number(element.strokeWidth || 1),
        opacity: Number.isFinite(element.opacity) ? element.opacity / 100 : 1,
        name: "Sketch shape"
      });
    }
    else if (element.type === "arrow" || element.type === "line" || element.type === "freedraw") {
      mona.elements.addLine(slideId, {
        left, top, width, height,
        color: element.strokeColor || context.theme.fontColor,
        endMarker: element.type === "arrow" ? "arrow" : "",
        name: "Sketch connector"
      });
    }
  }
}
else {
  const width = context.summary.viewportWidth;
  const height = context.summary.viewportHeight;
  const accent = context.theme.themeColors?.[0] || "#6d5dfc";
  mona.elements.addText(slideId, {
    text: "A clear story, designed to be edited",
    left: width * 0.08, top: height * 0.10, width: width * 0.72, height: height * 0.16,
    fontSize: 40, bold: true, color: context.theme.fontColor, name: "Agent title"
  });
  mona.elements.addText(slideId, {
    text: "Mona created these as native text and shape elements—not a flattened image.",
    left: width * 0.08, top: height * 0.27, width: width * 0.68, height: height * 0.10,
    fontSize: 19, color: "#52525b", name: "Agent subtitle"
  });
  const labels = ["Structure", "Visual hierarchy", "Editable output"];
  for (let index = 0; index < labels.length; index += 1) {
    const left = width * (0.08 + index * 0.29);
    mona.elements.addShape(slideId, {
      shape: "roundedRectangle", left, top: height * 0.48, width: width * 0.25,
      height: height * 0.28, fill: index === 0 ? accent : "#f4f4f5",
      stroke: index === 0 ? accent : "#e4e4e7", text: labels[index],
      textColor: index === 0 ? "#ffffff" : context.theme.fontColor,
      fontSize: 21, name: "Agent card " + (index + 1)
    });
  }
}
`

export const createReferenceAgentProvider = (): AgentProvider => ({
  id: 'reference',
  label: 'Reference engine',
  async generatePlan({ context }): Promise<AgentGeneratedPlan> {
    const sketch = Boolean(context.sketch?.elementCount)
    return {
      code: referenceProgram,
      explanation: sketch
        ? 'Convert the sketch into native editable text, shapes, and connectors'
        : 'Add a polished editable content structure to the current slide',
      providerId: 'reference',
      providerLabel: 'Reference engine',
    }
  },
})
