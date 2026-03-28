import React from 'react';
import { Link } from 'react-router-dom';

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, BarChart3, Clock, MapPin, Settings } from 'lucide-react';
import { format } from 'date-fns';

export default function MatchHeader({
    match,
    matchTitle,
    half,
    onHalfChange,
    scoreLine,
    backUrl,
    statsUrl,
    seasonStatsUrl,
    settingsUrl,
}) {
    return (
        <div className="bg-white border-b sticky top-0 z-10">
            <div className="max-w-7xl mx-auto px-4 py-[4px]">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5">
                    <div>
                        <div className="flex items-start gap-3">
                            {backUrl && (
                                <div className="pt-0.5">
                                    <Link to={backUrl}>
                                        <Button variant="ghost" size="sm" className="gap-2 px-2 h-7">
                                            <ArrowLeft className="w-4 h-4" /> Back
                                        </Button>
                                    </Link>
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

                                <div className="flex items-center gap-4 mt-0 text-xs text-slate-500">
                                    {match?.date && (
                                        <span className="flex items-center gap-1">
                                            <Clock className="w-3.5 h-3.5" />
                                            {format(new Date(match.date), 'dd MMM yyyy')}
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
                            <Link to={statsUrl}>
                                <Button variant="outline" size="sm" className="gap-2 h-7">
                                    <BarChart3 className="w-4 h-4" /> Stats
                                </Button>
                            </Link>
                        )}
                        {seasonStatsUrl && (
                            <Link to={seasonStatsUrl}>
                                <Button variant="outline" size="sm" className="gap-2 h-7">
                                    <BarChart3 className="w-4 h-4" /> Season
                                </Button>
                            </Link>
                        )}
                        {settingsUrl && (
                            <Link to={settingsUrl}>
                                <Button variant="outline" size="sm" className="gap-2 h-7">
                                    <Settings className="w-4 h-4" /> Settings
                                </Button>
                            </Link>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
