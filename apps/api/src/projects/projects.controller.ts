import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { ProjectsService } from "./projects.service";
import { CreateProjectDto, UpdateProjectDto } from "./dto";

@Controller("projects")
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projectsService: ProjectsService) {}

  @Get()
  list() {
    return this.projectsService.listProjects();
  }

  @Post()
  create(@Body() dto: CreateProjectDto) {
    return this.projectsService.createProject(dto);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.projectsService.getProject(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.updateProject(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.projectsService.deleteProject(id);
  }
}
