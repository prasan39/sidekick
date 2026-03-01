---
name: pptx-creator
description: Create, design, and generate PowerPoint presentations (.pptx files). Use this skill when the user asks to create a presentation, slide deck, slideshow, or PPT about any topic.
---

# PowerPoint Presentation Creator

You can create professional PowerPoint presentations using the `create_presentation` tool.
Before building slides, always use the template catalog in `templates.md` in this same folder.

## When to use this skill

Use this skill when the user says things like:
- "Create a presentation about X"
- "Make me a slide deck on X"
- "Build a PPT for X"
- "I need slides about X"

## How to use the `create_presentation` tool

The tool accepts:
- **title** (required): The presentation title
- **subtitle** (optional): A subtitle for the cover slide
- **author** (optional): Author name
- **slides** (required): Array of content slides — each with:
  - `title` (required)
  - `template` (recommended): one of `insight`, `comparison`, `timeline`, `metrics`, `process`, `quote`, `two-column`
  - `bullets` (array of strings) and/or `content` (free text)
  - optional `leftTitle` / `rightTitle` for `comparison`, and `source` for `quote`

> The cover slide and closing "Thank You" slide are auto-generated — do NOT include them in the `slides` array.

## Guidelines for great presentations

1. **Always plan first**: Think about the topic, then design 5–10 focused content slides
2. **One idea per slide**: Each slide title should be specific and actionable
3. **Bullets over paragraphs**: Use concise bullet points (5–7 words each), not long sentences
4. **Logical flow**: Introduction → Problem/Context → Main Points → Conclusion/CTA
5. **Rich content**: Aim for 4–6 bullets per slide for substance
6. **Use template variety**: Avoid repeating the same layout for every slide

## Example invocation

When the user asks for a presentation on "Remote Work Best Practices":

```json
{
  "title": "Remote Work Best Practices",
  "subtitle": "Building High-Performance Distributed Teams",
  "slides": [
    {
      "title": "The Remote Work Landscape",
      "template": "metrics",
      "bullets": [
        "Hybrid adoption: 70%",
        "Productivity lift: +13%",
        "Attrition drop: -17%"
      ]
    },
    {
      "title": "Setting Up Your Workspace",
      "template": "process",
      "bullets": [
        "Dedicated, distraction-free work area",
        "Reliable high-speed internet (50+ Mbps)",
        "Quality headset and webcam for video calls",
        "Ergonomic chair and standing desk option"
      ]
    },
    {
      "title": "Communication Protocols",
      "template": "comparison",
      "leftTitle": "Synchronous",
      "rightTitle": "Asynchronous",
      "bullets": [
        "Left: Daily standups for blockers",
        "Left: Fast decisions in meetings",
        "Right: Written updates in channels",
        "Right: Decision logs in docs"
      ]
    }
  ]
}
```

## After creating the presentation

- Always tell the user what was created and how many slides
- Offer to modify specific slides, add more content, or change the theme
- The download link will appear as a styled card in the chat
