import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminGuard, JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { PublicUser } from '../users/users.types';
import { AiCatalogService } from './ai-catalog.service';
import { AiChatService } from './ai-chat.service';

@Controller()
export class AiController {
  constructor(private readonly catalog: AiCatalogService, private readonly chat: AiChatService) {}

  @Get('api/ai/models')
  @UseGuards(OptionalJwtAuthGuard)
  publicCatalog(@CurrentUser() user: PublicUser | null) {
    return this.catalog.listPublic(user);
  }

  @Post('api/ai/chat')
  @HttpCode(202)
  @UseGuards(OptionalJwtAuthGuard)
  acceptChat(@Body() body: { message?: string; group_uid?: string; variant_uid?: string; editor_mode?: string; note_context?: unknown }, @CurrentUser() user: PublicUser | null, @Req() request: Request) {
    return this.chat.accept(body, user, request);
  }

  @Get('api/ai/chat/events')
  chatEvents(@Query('request_uid') requestUid: string, @Res() response: Response) {
    this.chat.stream(requestUid, response);
  }

  @Get('api/admin/ai/chat-logs')
  @UseGuards(JwtAuthGuard, AdminGuard)
  chatLogs(@Query() query: Record<string, unknown>) {
    return this.chat.listLogs(query);
  }

  @Post('api/admin/ai/env-check')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, AdminGuard)
  envCheck(@Body() body: { name?: string }) {
    return this.catalog.envCheck(body.name ?? '');
  }

  @Get('api/admin/ai/model-providers')
  @UseGuards(JwtAuthGuard, AdminGuard)
  providers() {
    return this.catalog.providers();
  }

  @Get('api/admin/ai/groups')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminGroups() {
    return this.catalog.listAdmin();
  }

  @Post('api/admin/ai/groups')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, AdminGuard)
  createGroup(@Body() body: Record<string, unknown>) {
    return this.catalog.createGroup(body);
  }

  @Put('api/admin/ai/groups/order')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, AdminGuard)
  reorderGroups(@Body() body: { uids?: string[] }) {
    this.catalog.reorderGroups(body.uids ?? []);
  }

  @Patch('api/admin/ai/groups/:uid')
  @UseGuards(JwtAuthGuard, AdminGuard)
  patchGroup(@Param('uid') uid: string, @Body() body: Record<string, unknown>) {
    return this.catalog.patchGroup(uid, body);
  }

  @Delete('api/admin/ai/groups/:uid')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, AdminGuard)
  deleteGroup(@Param('uid') uid: string) {
    this.catalog.deleteGroup(uid);
  }

  @Post('api/admin/ai/groups/:uid/models/import')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, AdminGuard)
  importModels(@Param('uid') uid: string, @Body() body: { providerId?: string; modelsUrl?: string; envVarName?: string }) {
    return this.catalog.importModels(uid, body);
  }

  @Post('api/admin/ai/groups/:uid/variants')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, AdminGuard)
  createVariant(@Param('uid') uid: string, @Body() body: Record<string, unknown>) {
    return this.catalog.createVariant(uid, body);
  }

  @Put('api/admin/ai/groups/:uid/variants/order')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, AdminGuard)
  reorderVariants(@Param('uid') uid: string, @Body() body: { uids?: string[] }) {
    this.catalog.reorderVariants(uid, body.uids ?? []);
  }

  @Patch('api/admin/ai/variants/:uid')
  @UseGuards(JwtAuthGuard, AdminGuard)
  patchVariant(@Param('uid') uid: string, @Body() body: Record<string, unknown>) {
    return this.catalog.patchVariant(uid, body);
  }

  @Delete('api/admin/ai/variants/:uid')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, AdminGuard)
  deleteVariant(@Param('uid') uid: string) {
    this.catalog.deleteVariant(uid);
  }
}
