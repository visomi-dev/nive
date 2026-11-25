import { Directive, ElementRef, afterRenderEffect, computed, inject, input, untracked } from '@angular/core';

import { Navigation } from './navigation';

@Directive({
  selector: 'h1[appNavigationHeading], h2[appNavigationHeading]',
  host: {
    '[attr.tabindex]': 'focusable() ? -1 : null',
    '[attr.data-navigation-focus]': "focusable() ? '' : null",
  },
})
export class NavigationHeading {
  private readonly navigation = inject(Navigation);
  private readonly element = inject(ElementRef<HTMLHeadingElement>);

  private readonly routeHeading = computed(
    () => this.element.nativeElement.tagName === 'H1' && this.navigation.headingFocus() !== null,
  );

  readonly appHeadingFocus = input(false);

  protected readonly focusable = computed(() => this.appHeadingFocus() || this.routeHeading());

  private readonly focusAfterNavigation = afterRenderEffect({
    write: () => {
      if (this.routeHeading() || this.appHeadingFocus()) {
        untracked(() => this.element.nativeElement.focus());
      }
    },
  });
}
