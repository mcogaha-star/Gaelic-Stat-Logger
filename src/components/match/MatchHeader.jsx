import React from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Clock, MapPin, Repeat2, Undo2, Users } from 'lucide-react';
import { format } from 'date-fns';

export default function MatchHeader({
    match,
    matchTitle,
    half,
    onHalfChange,
    onUndo,
    onExport,
    onSub,
    onEndPeriod,
    statsCount
}) {
    return (
        <div className="bg-white border-b sticky top-0 z-10">
            <div className="max-w-7xl mx-auto px-4 py-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">
                            {matchTitle || (match?.opponent ? `vs ${match.opponent}` : 'Match')}
                        </h1>
                        <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
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
                    
                    <div className="flex items-center gap-3">
                        <Badge variant="secondary" className="text-sm">
                            {statsCount} stats logged
                        </Badge>
                        
                        <Select value={half} onValueChange={onHalfChange}>
                            <SelectTrigger className="w-36">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="first">1st Half</SelectItem>
                                <SelectItem value="second">2nd Half</SelectItem>
                                <SelectItem value="et_first">ET 1st Half</SelectItem>
                                <SelectItem value="et_second">ET 2nd Half</SelectItem>
                            </SelectContent>
                        </Select>

                        <Button
                            variant="outline"
                            onClick={onEndPeriod}
                            className="gap-2"
                            title="Log end of half and switch"
                        >
                            <Repeat2 className="w-4 h-4" />
                            <span className="hidden sm:inline">End Half</span>
                        </Button>

                        <Button
                            variant="outline"
                            onClick={onSub}
                            className="gap-2"
                            title="Log a substitution"
                        >
                            <Users className="w-4 h-4" />
                            <span className="hidden sm:inline">Sub</span>
                        </Button>

                        <Button
                            variant="outline"
                            onClick={onUndo}
                            className="gap-2"
                            disabled={!statsCount}
                            title="Undo last stat (Ctrl/Cmd+Z)"
                        >
                            <Undo2 className="w-4 h-4" />
                            <span className="hidden sm:inline">Undo</span>
                        </Button>
                        
                        <Button 
                            variant="outline" 
                            onClick={onExport}
                            className="gap-2"
                        >
                            <Download className="w-4 h-4" />
                            <span className="hidden sm:inline">Export CSV</span>
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
