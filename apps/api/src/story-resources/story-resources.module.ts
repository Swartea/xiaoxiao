import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma.module";
import { StoryReferenceExtractorService } from "./story-reference-extractor.service";
import { StoryReferenceService } from "./story-reference.service";
import { StoryResourceSearchService } from "./story-resource-search.service";
import { StoryResourcesController } from "./story-resources.controller";
import { StoryResourcesService } from "./story-resources.service";

@Module({
  imports: [PrismaModule],
  controllers: [StoryResourcesController],
  providers: [
    StoryResourcesService,
    StoryResourceSearchService,
    StoryReferenceService,
    StoryReferenceExtractorService,
  ],
  exports: [
    StoryResourcesService,
    StoryResourceSearchService,
    StoryReferenceService,
    StoryReferenceExtractorService,
  ],
})
export class StoryResourcesModule {}
