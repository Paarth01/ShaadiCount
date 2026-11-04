import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { RequestIdMiddleware } from './common/filters';
import { HealthController } from './health/health.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { WorkspacesController } from './workspaces/workspaces.controller';
import { WorkspacesService } from './workspaces/workspaces.service';
import { EventsController } from './events/events.controller';
import { EventsService } from './events/events.service';
import { GuestsController } from './guests/guests.controller';
import { GuestsService } from './guests/guests.service';
import { SuppressionService } from './guests/suppression.service';
import { InvitationsController } from './invitations/invitations.controller';
import { InvitationsService } from './invitations/invitations.service';
import { TokensService } from './invitations/tokens.service';
import { PublicRsvpController } from './rsvp/rsvp.controller';
import { RsvpService } from './rsvp/rsvp.service';
import { ReportingController } from './reporting/reporting.controller';
import { ReportingService } from './reporting/reporting.service';
import { MessagingController, WebhookController } from './messaging/messaging.controller';
import { CampaignsService } from './messaging/campaigns.service';
import { DispatcherService } from './messaging/dispatcher.service';
import { EligibilityService } from './messaging/eligibility.service';
import { FakeProvider, LiveProviderStub, ProviderFactory } from './messaging/provider';
import { WebhooksService } from './messaging/webhooks.service';
import { OutboxRelayService } from './messaging/outbox-relay.service';
import { CheckinController } from './checkin/checkin.controller';
import { CheckinService } from './checkin/checkin.service';
import { PrivacyController } from './privacy/privacy.controller';
import { PrivacyService, RetentionService } from './privacy/privacy.service';
import { OutboxService } from './common/outbox.service';

@Module({
  imports: [CommonModule],
  controllers: [
    HealthController,
    AuthController,
    WorkspacesController,
    EventsController,
    GuestsController,
    InvitationsController,
    PublicRsvpController,
    ReportingController,
    MessagingController,
    WebhookController,
    CheckinController,
    PrivacyController,
  ],
  providers: [
    AuthService,
    WorkspacesService,
    EventsService,
    GuestsService,
    SuppressionService,
    InvitationsService,
    TokensService,
    RsvpService,
    OutboxService,
    ReportingService,
    CampaignsService,
    DispatcherService,
    EligibilityService,
    FakeProvider,
    LiveProviderStub,
    ProviderFactory,
    WebhooksService,
    OutboxRelayService,
    CheckinService,
    PrivacyService,
    RetentionService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
