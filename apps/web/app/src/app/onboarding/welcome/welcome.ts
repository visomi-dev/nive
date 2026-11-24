import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Card, Heading, LinkButton, Text } from '../../ui';

@Component({
  selector: 'app-welcome',
  imports: [NavigationHeading, Card, Heading, LinkButton, RouterLink, Text],
  templateUrl: './welcome.html',
})
export class Welcome {}
