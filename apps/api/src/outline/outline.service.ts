import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { PatchOutlineDto } from "./dto";

@Injectable()
export class OutlineService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async ensureProject(projectId: string) {
    const found = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!found) {
      throw new NotFoundException("Project not found");
    }
    return found;
  }

  async getOutline(projectId: string) {
    await this.ensureProject(projectId);
    return this.prisma.storyOutlineNode.findMany({
      where: { project_id: projectId },
      orderBy: { phase_no: "asc" },
    });
  }

  async patchOutline(projectId: string, dto: PatchOutlineDto) {
    await this.ensureProject(projectId);

    const uniqueNodes = new Map<number, PatchOutlineDto["nodes"][number]>();
    for (const node of dto.nodes) {
      uniqueNodes.set(node.phase_no, node);
    }

    const nodes = Array.from(uniqueNodes.values()).sort((a, b) => a.phase_no - b.phase_no);

    await this.prisma.$transaction(async (tx) => {
      await tx.storyOutlineNode.deleteMany({ where: { project_id: projectId } });
      if (nodes.length > 0) {
        await tx.storyOutlineNode.createMany({
          data: nodes.map((node) => ({
            project_id: projectId,
            phase_no: node.phase_no,
            title: node.title,
            summary: node.summary,
            goal: node.goal,
            conflict: node.conflict,
            milestone_chapter_no: node.milestone_chapter_no,
          })),
        });
      }
    });

    return this.getOutline(projectId);
  }
}
