import {
  readTemplateStructureFromJson,
  saveTemplateStructureToJson,
  type TemplateFolder,
} from "@/modules/playground/lib/path-to-json";
import { db } from "@/lib/db";
import { templatePaths } from "@/lib/template";
import path from "path";
import fs from "fs/promises";
import { NextRequest } from "next/server";

// In-memory cache keyed by template key (e.g. "REACT", "NEXTJS").
// Cache lives for the lifetime of the server process, so repeated playground
// loads for the same template skip the filesystem scan entirely.
const templateJsonCache = new Map<string, TemplateFolder>();

function validateJsonStructure(data: unknown): boolean {
  try {
    JSON.parse(JSON.stringify(data)); // Ensures it's serializable
    return true;
  } catch (error) {
    console.error("Invalid JSON structure:", error);
    return false;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {

const {id} = await params;

if(!id){
      return Response.json({ error: "Missing playground ID" }, { status: 400 });
}

const playground = await db.playground.findUnique({
    where:{id}
})

  if (!playground) {
    return Response.json({ error: "Playground not found" }, { status: 404 });
  }
  
  const templateKey = playground.template as keyof typeof templatePaths;
  const templatePath = templatePaths[templateKey]

    if (!templatePath) {
    return Response.json({ error: "Invalid template" }, { status: 404 });
  }

  try {
    // Return from cache if available
    const cached = templateJsonCache.get(templateKey);
    if (cached) {
      console.log(`Template cache hit for ${templateKey}`);
      return Response.json({ success: true, templateJson: cached }, { status: 200 });
    }

    console.log(`Template cache miss for ${templateKey}, scanning filesystem...`);
    const inputPath = path.join(process.cwd() , templatePath);
    const outputFile = path.join(process.cwd() , `output/${templateKey}.json`);

    await saveTemplateStructureToJson(inputPath , outputFile);
    const result = await readTemplateStructureFromJson(outputFile);


    // Validate the JSON structure before saving
    if (!validateJsonStructure(result.items)) {
      return Response.json({ error: "Invalid JSON structure" }, { status: 500 });
    }

    await fs.unlink(outputFile)

    // Store in cache for subsequent requests
    templateJsonCache.set(templateKey, result);

      return Response.json({ success: true, templateJson: result }, { status: 200 });
  } catch (error) {
      console.error("Error generating template JSON:", error);
    return Response.json({ error: "Failed to generate template" }, { status: 500 });
  }


}
