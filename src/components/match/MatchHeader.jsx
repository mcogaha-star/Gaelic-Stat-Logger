import React from 'react';
import { Link } from 'react-router-dom';

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, BarChart3, BookOpen, Clock, MapPin, Settings } from 'lucide-react';
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
    return (
        <div className={`bg-white border-b ${sticky ? 'sticky top-0 z-10' : ''}`} data-tour-id="logger-header">
            <div className="max-w-7xl mx-auto px-4 py-[4px]">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5">
                    <div>
                        <div className="flex items-start gap-3" data-tour-id="logger-header-summary">
                            {backUrl && (
                                <div className="shrink-0 pt-0.5">
                                    {typeof onBackClick === 'function' ? (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-10 shrink-0 rounded-full px-4 text-base font-semibold shadow-sm sm:h-7 sm:px-2 sm:text-sm"
                                            onClick={onBackClick}
                                        >
                                            <ArrowLeft className="w-4 h-4" /> Back
                                        </Button>
                                    ) : (
                                        <Button
                                            asChild
                                            variant="outline"
                                            size="sm"
                                            className="h-10 shrink-0 rounded-full px-4 text-base font-semibold shadow-sm sm:h-7 sm:px-2 sm:text-sm"
                                        >
                                          <Link to={backUrl}>
                                            <ArrowLeft className="w-4 h-4" /> Back
                                          </Link>
                                        </Button>
                                    )}
                                </div>
                            )}

                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-3">
                                <h1 className="text-lg font-bold text-slate-900">
                                    {matchTitle || (match?.opponent ? `vs ${match.opponent}` : 'Match')}
                                </h1>

                                {scoreLine && (
                                    <Badge variant="outline" className="text-xs font-semibold h-7 w-32 inline-flex items-center justify-center">
                                        {scoreLine}
                                    </Badge>
                                )}

                                <div data-tour-id="logger-half-select">
                                    <Select value={half} onValueChange={onHalfChange}>
                                        <SelectTrigger className="w-32 h-7">
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

                                <div className="flex items-center gap-4 mt-0 text-xs text-slate-500">
                                    {match?.date && (
                                        <span className="flex items-center gap-1">
                                            <Clock className="w-3.5 h-3.5" />
                                            {safeFormatDate(match.date)}
                                        </span>
                                    )}
                                    {match?.venue && (
                                        <span className="flex items-center gap-1">
                                            <MapPin className="w-3.5 h-3.5" />
                                            {match.venue}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-2 justify-end">
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
            </div>
        </div>
    );
}
