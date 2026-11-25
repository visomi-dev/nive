import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Card, Heading, LinkButton, Text } from '../../ui';

export type ImportStep = 'choose' | 'local' | 'agent';

@Component({
  selector: 'app-bring-movements',
  imports: [Card, Heading, LinkButton, NavigationHeading, RouterLink, Text],
  templateUrl: './bring-movements.html',
})
export class BringMovements {
  readonly step = input.required<ImportStep>();
  readonly supported = input(false);
}
