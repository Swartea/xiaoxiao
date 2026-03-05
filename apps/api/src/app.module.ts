import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { resolve } from "node:path";
import { PrismaService } from "./prisma.service";
import { ProjectsController } from "./projects/projects.controller";
import { ProjectsService } from "./projects/projects.service";
import { BibleController } from "./bible/bible.controller";
import { BibleService } from "./bible/bible.service";
import { ChaptersController } from "./chapters/chapters.controller";
import { ChaptersService } from "./chapters/chapters.service";
import { GenerationController } from "./generation/generation.controller";
import { GenerationService } from "./generation/generation.service";
import { WorkspaceController } from "./workspace/workspace.controller";
import { WorkspaceService } from "./workspace/workspace.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Support running from repo root or apps/api cwd.
      envFilePath: [
        resolve(process.cwd(), "apps/api/.env"),
        resolve(process.cwd(), ".env"),
        ".env",
      ],
    }),
  ],
  controllers: [ProjectsController, BibleController, ChaptersController, GenerationController, WorkspaceController],
  providers: [PrismaService, ProjectsService, BibleService, ChaptersService, GenerationService, WorkspaceService],
})
export class AppModule {}
