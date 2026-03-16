import { Inject, Injectable } from "@nestjs/common";
import {
  CreateEntityDto,
  PatchBibleDto,
  UpdateEntityDto,
} from "./dto";
import { StoryResourcesService } from "../story-resources/story-resources.service";

@Injectable()
export class BibleService {
  constructor(@Inject(StoryResourcesService) private readonly storyResourcesService: StoryResourcesService) {}

  getBible(projectId: string) {
    return this.storyResourcesService.getBible(projectId);
  }

  patchBible(projectId: string, dto: PatchBibleDto) {
    return this.storyResourcesService.patchBible(projectId, dto);
  }

  listEntities(projectId: string) {
    return this.storyResourcesService.listEntities(projectId);
  }

  createEntity(projectId: string, dto: CreateEntityDto) {
    return this.storyResourcesService.createEntity(projectId, dto);
  }

  updateEntity(projectId: string, entityId: string, dto: UpdateEntityDto) {
    return this.storyResourcesService.updateEntity(projectId, entityId, dto);
  }

  deleteEntity(projectId: string, entityId: string) {
    return this.storyResourcesService.deleteEntity(projectId, entityId);
  }
}
