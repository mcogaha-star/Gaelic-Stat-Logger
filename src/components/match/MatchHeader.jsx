import React from 'react';
import { Link } from 'react-router-dom';

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ArrowLeft, BarChart3, BookOpen, Clock, EllipsisVertical, MapPin, Settings } from 'lucide-react';
import { format } from 'date-fns';

function safeFormatDate(value) {
    if (!value) return '';
    try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return format(date, 'dd MMM yyyy');
    } catch {
        return String(value);
    }
}

export default function MatchHeader({
    match,
    matchTitle,
    half,
    onHalfChange,
    scoreLine,
    backUrl,
    statsUrl,
    dataUrl,
    onDataClick,
    seasonStatsUrl,
    settingsUrl,
    settingsLabel = 'Settings',
    helpUrl,
    onHelpClick,
    helpLabel = 'Help',
    onBackClick,
    sticky = true,
}) {
    const [mobileActionsOpen, setMobileActionsOpen] = React.useState(false);

    const actionItems = [
        statsUrl ? {
            key: 'stats',
            icon: BarChart3,
            label: 'Match Reports',
            href: statsUrl,
        } : null,
        (dataUrl || onDataClick) ? {
            key: 'data',
            icon: BarChart3,
            label: 'Data',
            href: onDataClick ? null : dataUrl,
            onClick: onDataClick || null,
            tourId: 'logger-data-button',
        } : null,
        seasonStatsUrl ? {
            key: 'season',
            icon: BarChart3,
            label: 'Season Stats',
            href: seasonStatsUrl,
        } : null,
        settingsUrl ? {
            key: 'settings',
            icon: Settings,
            label: settingsLabel,
            href: settingsUrl,
            tourId: 'logger-settings-button',
        } : null,
        onHelpClick ? {
            key: 'help',
            icon: BookOpen,
            label: helpLabel,
            onClick: onHelpClick,
            tourId: 'logger-help-button',
        } : helpUrl ? {
            key: 'help',
            icon: BookOpen,
            label: helpLabel,
            href: helpUrl,
            tourId: 'logger-help-button',
        } : null,
    ].filter(Boolean);

    return (
        <div className={`bg-white border-b ${sticky ? 'sticky top-0 z-10' : ''}`} data-tour-id="logger-header">
            <div className="max-w-7xl mx-auto px-4 py-[4px]">
                <div className="sm:hidden space-y-3" data-tour-id="logger-header-summary">
                    <div className="flex items-center justify-between gap-3">
                        {backUrl ? (
                            <div className="shrink-0">
                                {typeof onBackClick === 'function' ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-10 rounded-full px-4 text-base font-semibold shadow-sm"
                                        onClick={onBackClick}
                                    >
                                        <ArrowLeft className="w-4 h-4" /> Back
                                    </Button>
                                ) : (
                                    <Button
                                        asChild
                                        variant="outline"
                                        size="sm"
                                        className="h-10 rounded-full px-4 text-base font-semibold shadow-sm"
                                    >
                                        <Link to={backUrl}>
                                            <ArrowLeft className="w-4 h-4" /> Back
                                        </Link>
                                    </Button>
                                )}
                            </div>
                        ) : <div />}

                        {actionItems.length > 0 ? (
                            <Sheet open={mobileActionsOpen} onOpenChange={setMobileActionsOpen}>
                                <SheetTrigger asChild>
                                    <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-full shadow-sm">
                                        <EllipsisVertical className="h-5 w-5" />
                                        <span className="sr-only">Open logger actions</span>
                                    </Button>
                                </SheetTrigger>
                                <SheetContent side="right" className="w-[88vw] max-w-sm px-5 py-6">
                                    <SheetHeader className="space-y-1 text-left">
                                        <SheetTitle>Logger Menu</SheetTitle>
                                        <SheetDescription>
                                            Quick access to data, help, and logger settings.
                                        </SheetDescription>
                                    </SheetHeader>
                                    <div className="mt-6 space-y-3">
                                        {actionItems.map((item) => {
                                            const Icon = item.icon;
                                            if (item.onClick) {
                                                return (
                                                    <Button
                                                        key={item.key}
                                                        type="button"
                                                        variant="outline"
                                                        className="h-12 w-full justify-start gap-3 rounded-2xl text-base font-semibold"
                                                        onClick={() => {
                                                            setMobileActionsOpen(false);
                                                            item.onClick();
                                                        }}
                                                        data-tour-id={item.tourId}
                                                    >
                                                        <Icon className="h-5 w-5" />
                                                        {item.label}
                                                    </Button>
                                                );
                                            }

                                            return (
                                                <Button
                                                    key={item.key}
                                                    asChild
                                                    variant="outline"
                                                    className="h-12 w-full justify-start gap-3 rounded-2xl text-base font-semibold"
                                                    data-tour-id={item.tourId}
                                                >
                                                    <Link to={item.href}>
                                                        <Icon className="h-5 w-5" />
                                                        {item.label}
                                                    </Link>
                                                </Button>
                                            );
                                        })}
                                    </div>
                                </SheetContent>
                            </Sheet>
                        ) : null}
                    </div>

                    <div className="space-y-2">
                        <h1 className="text-[clamp(1.6rem,5vw,2.2rem)] font-bold leading-tight text-slate-900">
                            {matchTitle || (match?.opponent ? `vs ${match.opponent}` : 'Match')}
                        </h1>

                        <div className="grid grid-cols-2 gap-2 items-stretch">
                            {scoreLine ? (
                                <Badge variant="outline" className="h-12 w-full justify-center rounded-2xl text-base font-semibold">
                                    {scoreLine}
                                </Badge>
                            ) : (
                                <div />
                            )}

                            <div data-tour-id="logger-half-select">
                                <Select value={half} onValueChange={onHalfChange}>
                                    <SelectTrigger className="h-12 w-full rounded-2xl text-base">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="first">1st Half</SelectItem>
                                        <SelectItem value="second">2nd Half</SelectItem>
                                        <SelectItem value="et_first">ET 1st Half</SelectItem>
                                        <SelectItem value="et_second">ET 2nd Half</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                            {match?.date && (
                                <span className="flex items-center gap-1.5">
                                    <Clock className="w-4 h-4" />
                                    {safeFormatDate(match.date)}
                                </span>
                            )}
                            {match?.venue && (
                                <span className="flex items-center gap-1.5">
                                    <MapPin className="w-4 h-4" />
                                    {match.venue}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="hidden sm:block space-y-2">
                    <div className="flex items-start justify-between gap-4" data-tour-id="logger-header-summary">
                        <div className="min-w-0 flex items-start gap-3">
                            {backUrl && (
                                <div className="shrink-0 pt-0.5">
                                    {typeof onBackClick === 'function' ? (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-10 shrink-0 rounded-full px-4 text-base font-semibold shadow-sm md:h-7 md:px-2 md:text-sm"
                                            onClick={onBackClick}
                                        >
                                            <ArrowLeft className="w-4 h-4" /> Back
                                        </Button>
                                    ) : (
                                        <Button
                                            asChild
                                            variant="outline"
                                            size="sm"
                                            className="h-10 shrink-0 rounded-full px-4 text-base font-semibold shadow-sm md:h-7 md:px-2 md:text-sm"
                                        >
                                            <Link to={backUrl}>
                                                <ArrowLeft className="w-4 h-4" /> Back
                                            </Link>
                                        </Button>
                                    )}
                                </div>
                            )}

                            <div className="min-w-0">
                                <h1 className="truncate text-lg font-bold text-slate-900 md:text-xl">
                                    {matchTitle || (match?.opponent ? `vs ${match.opponent}` : 'Match')}
                                </h1>
                            </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2 justify-end">
                            {statsUrl && (
                                <Button asChild variant="outline" size="sm" className="gap-2 h-7">
                                  <Link to={statsUrl}>
                                    <BarChart3 className="w-4 h-4" /> Match Reports
                                  </Link>
                                </Button>
                            )}
                            {(dataUrl || onDataClick) && (
                                onDataClick ? (
                                    <Button type="button" variant="outline" size="sm" className="gap-2 h-7" onClick={onDataClick} data-tour-id="logger-data-button">
                                        <BarChart3 className="w-4 h-4" /> Data
                                    </Button>
                                ) : (
                                    <Button asChild variant="outline" size="sm" className="gap-2 h-7" data-tour-id="logger-data-button">
                                      <Link to={dataUrl}>
                                        <BarChart3 className="w-4 h-4" /> Data
                                      </Link>
                                    </Button>
                                )
                            )}
                            {seasonStatsUrl && (
                                <Button asChild variant="outline" size="sm" className="gap-2 h-7">
                                  <Link to={seasonStatsUrl}>
                                    <BarChart3 className="w-4 h-4" /> Season Stats
                                  </Link>
                                </Button>
                            )}
                            {settingsUrl && (
                                <Button asChild variant="outline" size="sm" className="gap-2 h-7" data-tour-id="logger-settings-button">
                                  <Link to={settingsUrl}>
                                    <Settings className="w-4 h-4" /> {settingsLabel}
                                  </Link>
                                </Button>
                            )}
                            {onHelpClick ? (
                                <Button type="button" variant="outline" size="sm" className="gap-2 h-7" onClick={onHelpClick} data-tour-id="logger-help-button">
                                    <BookOpen className="w-4 h-4" /> {helpLabel}
                                </Button>
                            ) : helpUrl ? (
                                <Button asChild variant="outline" size="sm" className="gap-2 h-7" data-tour-id="logger-help-button">
                                  <Link to={helpUrl}>
                                    <BookOpen className="w-4 h-4" /> {helpLabel}
                                  </Link>
                                </Button>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-slate-500">
                        {match?.date && (
                            <span className="flex items-center gap-1 shrink-0">
                                <Clock className="w-3.5 h-3.5" />
                                {safeFormatDate(match.date)}
                            </span>
                        )}
                        {match?.venue && (
                            <span className="flex items-center gap-1 min-w-0">
                                <MapPin className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{match.venue}</span>
                            </span>
                        )}
                        {scoreLine && (
                            <Badge variant="outline" className="h-10 min-w-36 justify-center rounded-2xl px-4 text-base font-semibold text-slate-900 md:h-9 md:min-w-32 md:text-sm">
                                {scoreLine}
                            </Badge>
                        )}
                        <div data-tour-id="logger-half-select" className="shrink-0">
                            <Select value={half} onValueChange={onHalfChange}>
                                <SelectTrigger className="h-10 w-40 rounded-2xl text-slate-900 md:h-9 md:w-36">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="first">1st Half</SelectItem>
                                    <SelectItem value="second">2nd Half</SelectItem>
                                    <SelectItem value="et_first">ET 1st Half</SelectItem>
                                    <SelectItem value="et_second">ET 2nd Half</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
