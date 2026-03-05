import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { CreateProjectDto, UpdateProjectDto } from "./dto";

@Injectable()
export class ProjectsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listProjects() {
    return this.prisma.project.findMany({
      orderBy: { created_at: "desc" },
    });
  }

  async createProject(dto: CreateProjectDto) {
    return this.prisma.project.create({
      data: {
        title: dto.title,
        genre: dto.genre,
        target_platform: dto.target_platform,
        pov: dto.pov,
        tense: dto.tense,
        style_preset_id: dto.style_preset_id,
      },
    });
  }

  async getProject(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { stylePreset: true },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    return project;
  }

  async updateProject(id: string, dto: UpdateProjectDto) {
    await this.getProject(id);
    return this.prisma.project.update({
      where: { id },
      data: dto,
    });
  }

  async deleteProject(id: string) {
    await this.getProject(id);
    await this.prisma.project.delete({
      where: { id },
    });

    return { success: true };
  }
}
