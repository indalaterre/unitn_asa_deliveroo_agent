
(define (domain delivery)
  (:requirements :strips :typing :action-costs)
  (:types agent package location)

  (:predicates
    (at ?a - agent ?l - location)
    (at-pkg ?p - package ?l - location)
    (is-delivery ?l - location)
    (carrying ?a - agent ?p - package)
    (available ?p - package)
    (different ?from ?to - location)
  )

  (:functions
    (score ?p - package)
    (distance ?from ?to - location)

    ;; Metric functions
    (total-cost) ;; Total move cost. Must be minimized (The cost will contain the parcels decaying information)
    (carrying-parcels)
    (delivered-parcels) ;; Number of delivered parcels. Should be maximized
  )

  (:action move
    :parameters (?a - agent ?from - location ?to - location)
    :precondition (and
      (at ?a ?from)
      (different ?from ?to)
    )
    :effect (and
      (not (at ?a ?from))
      (at ?a ?to)
      (increase (total-cost) (distance ?from ?to)) ;; Basic cost for movement
    )
  )

  (:action pick-up
    :parameters (?a - agent ?p - package ?l - location)
    :precondition (and
      (at ?a ?l)
      (at-pkg ?p ?l)
      (available ?p)
    )
    :effect (and
      (carrying ?a ?p)
      (not (at-pkg ?p ?l))
      (increase (carrying-parcels) 1)
    )
  )

  (:action deliver
    :parameters (?a - agent ?p - package ?l - location)
    :precondition (and
      (at ?a ?l)
      (carrying ?a ?p)
      (is-delivery ?l)
    )
    :effect (and
      (not (carrying ?a ?p))
      (decrease (carrying-parcels) 1)
      (decrease (total-cost) (score ?p)) ;; Reward with package score
      (increase (delivered-parcels) 1) ;; Increase the number of delivered parcels
    )
  )
)
