import * as React from '@theia/core/shared/react';
import type { PlanReview } from '../../common/plan-review/plan-review.types';
import { reviewHeadline } from '../../common/plan-review/plan-review.utils';

export interface PlanReviewCardProps {
    readonly review: PlanReview;
    readonly onOpen: (path: string) => void;
}

/** IDEA-306: the run's diff against the approved plan: matched steps, missing steps and out-of-scope files. */
export const PlanReviewCard = ({ review, onOpen }: PlanReviewCardProps): React.ReactElement =>
    <div className='ingot-plan-review' data-matched={review.matched} data-total={review.total}>
        <div className='ingot-plan-review-head'>
            <span className='codicon codicon-checklist' aria-hidden='true' />
            <span className='ingot-plan-review-title'>Plan review</span>
            <span className='ingot-plan-review-summary'>{reviewHeadline(review)}</span>
            <span className='ingot-flex' />
            <button type='button' className='ingot-plan-review-open' title={review.path} onClick={() => onOpen(review.path)}>Open plan</button>
        </div>
        <ul className='ingot-plan-review-steps'>
            {review.steps.map((step, i) => <li key={i} className={`ingot-plan-review-step ${step.state}`} data-state={step.state}>
                <span className={`codicon codicon-${step.state === 'matched' ? 'check' : 'circle-slash'}`} aria-label={step.state === 'matched' ? 'Matched' : 'Missing'} />
                <span className='ingot-plan-review-text'>{step.text}</span>
                {step.evidence.length > 0
                    ? <span className='ingot-plan-review-evidence'>{step.evidence.join(', ')}</span>
                    : <span className='ingot-plan-review-evidence'>missing</span>}
            </li>)}
        </ul>
        {review.outOfScope.length > 0 && <div className='ingot-plan-review-scope'>
            <span className='codicon codicon-warning' aria-hidden='true' />
            <span>Out of scope:</span>
            {review.outOfScope.map(file => <button type='button' key={file} className='ingot-plan-review-file' onClick={() => onOpen(file)}>{file}</button>)}
        </div>}
    </div>;
